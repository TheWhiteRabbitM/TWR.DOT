import {
  createContract,
  createContractRuntimeFromClient,
  ensureContractAccountMapped,
  QUERY_FALLBACK_ORIGIN,
} from '@parity/product-sdk/contracts';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { SignerManager } from '@parity/product-sdk-signer';
import type { ChainDefinition, HexString, PolkadotClient } from 'polkadot-api';

/**
 * The subset of the SDK's `App.chain` this driver needs.
 *
 * Typed structurally so the driver does not depend on the SDK re-exporting its
 * `ChainApi` interface under a particular name.
 */
export interface ChainAccess {
  connect(chains: Record<string, ChainDefinition>): Promise<unknown>;
  getRawClient(descriptor: ChainDefinition): PolkadotClient;
}
import { THE_BUTTON_ABI } from './abi';
import type { ButtonDriver, Presser } from './types';

/** How many roll entries to pull in one read. */
const ROLL_PAGE = 100n;

/** Nothing here should take this long; a hang must surface as an error. */
const CONNECT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 20_000;
const TX_TIMEOUT_MS = 120_000;

/**
 * Every await in this module goes through here.
 *
 * A promise that never settles used to leave the UI on "reading register"
 * forever with nothing to debug. Losing the race turns that into a named error.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Retry a transient chain failure.
 *
 * The host's light client reports "ChainHead follow request failed, retrying…"
 * while it re-establishes, and a query issued in that window completes without
 * emitting. One shot at the wrong moment is not a real failure.
 */
async function retry<T>(
  operation: () => Promise<T>,
  attempts: number,
  baseDelayMs: number,
  onRetry?: (attempt: number) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        onRetry?.(attempt);
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }

  throw lastError;
}

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  return Number(value ?? 0);
}

/**
 * A multi-output ABI read decodes to either a positional array or an object
 * keyed by output name, depending on the decoder. Accept both.
 */
function pick(value: unknown, index: number, name: string): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === 'object') return (value as Record<string, unknown>)[name];
  return undefined;
}

function describeFailure(method: string, value: unknown): Error {
  return new Error(`${method} failed on chain: ${JSON.stringify(value ?? null)}`);
}

export interface ChainDriverOptions {
  /**
   * The host's chain API (`app.chain`).
   *
   * Connections must go through this rather than `createChainClient`, which
   * opens its own connection and makes the host raise a "Direct Chain Access"
   * warning at the user instead of reusing the container's shared connection.
   */
  chain: ChainAccess;
  /** Deployed TheButton address. */
  address: HexString;
  /** SS58 address of the signed-in account. Used as the dry-run origin. */
  account: string;
  /**
   * EVM address of the same account. This is what the contract's
   * `snapshot(address)` and the personhood precompile actually take — passing
   * the SS58 address here silently reads the wrong account.
   */
  h160Address: HexString;
  /** DotNS username, when the host exposes one. */
  username: string | null;
  /** Resolves the signer at call time, so account switches are picked up. */
  signerManager: SignerManager;
  /** Reports the current step so a slow or stuck stage is visible in the UI. */
  onStep?: (step: string) => void;
}

/**
 * Real driver: reads and writes TheButton on devnet Asset Hub.
 *
 * The SDK routes every connection through the host container's provider and has
 * no direct-WebSocket fallback, so this only works inside the Polkadot app or
 * the web gateway.
 */
export async function createChainDriver(options: ChainDriverOptions): Promise<ButtonDriver> {
  const { chain, address, account, h160Address, username, signerManager, onStep } = options;
  const step = (message: string) => onStep?.(message);

  step('connecting via host api');
  await withTimeout(
    chain.connect({ assetHub: devnet_asset_hub }),
    CONNECT_TIMEOUT_MS,
    'chain connect',
  );

  step('preparing contract');
  const client = chain.getRawClient(devnet_asset_hub);
  const runtime = createContractRuntimeFromClient(client, devnet_asset_hub);

  // signerManager resolves the current account for signing transactions.
  const contract = createContract(runtime, address, THE_BUTTON_ABI, { signerManager });

  // Read-only dry-runs must NOT run as the user: pallet-revive rejects any
  // unmapped origin with AccountUnmapped, and a fresh account is always
  // unmapped. QUERY_FALLBACK_ORIGIN is the pallet's own module account, mapped
  // by construction. The SDK would fall back to it on its own, except that its
  // origin resolution prefers the signerManager's selected account — which is
  // exactly the unmapped one — so it has to be forced per query. This is what
  // put "AccountUnmapped" on screen the first time a real user loaded the app.
  const QUERY = { origin: QUERY_FALLBACK_ORIGIN };

  // Account mapping is deliberately NOT done here. ensureContractAccountMapped
  // submits a transaction when the account is unmapped, and making a read-only
  // page load wait on a signature is what left the UI stuck on "reading
  // register". It runs lazily in press(), which is the only path that needs it.
  let mapped = false;

  async function ensureMapped(): Promise<void> {
    if (mapped) return;
    const signer = signerManager.getSigner();
    if (!signer) throw new Error('no signer available — is an account selected?');

    step('mapping account for pallet-revive');
    const result = await withTimeout(
      ensureContractAccountMapped(runtime, account, signer),
      TX_TIMEOUT_MS,
      'account mapping',
    );
    if (!result.ok) {
      throw new Error(`account mapping failed: ${String(result.error)}`);
    }
    mapped = true;
  }

  return {
    async load() {
      step('reading snapshot');
      const snap = await retry(
        () =>
          withTimeout(
            contract.snapshot.query(h160Address, QUERY),
            QUERY_TIMEOUT_MS,
            'snapshot',
          ),
        3,
        1500,
        (attempt) => step(`chain not ready, retry ${attempt} of 2`),
      );
      if (!snap.success) throw describeFailure('snapshot', snap.value);

      const total = toNumber(pick(snap.value, 0, 'total'));
      const yourOrdinal = toNumber(pick(snap.value, 1, 'yourOrdinal'));
      const tier = toNumber(pick(snap.value, 2, 'yourStatus'));

      step('reading register');
      const roll: Presser[] = [];
      try {
        const page = await withTimeout(
          contract.roll.query(0n, ROLL_PAGE, QUERY),
          QUERY_TIMEOUT_MS,
          'roll',
        );
        if (page.success && Array.isArray(page.value)) {
          page.value.forEach((entry, index) => {
            roll.push({
              ordinal: index + 1,
              who: String(pick(entry, 0, 'who') ?? ''),
              pressedAt: toNumber(pick(entry, 1, 'pressedAt')),
            });
          });
        }
      } catch {
        // The roll is decoration. A failure here must not hide the counter.
      }

      return {
        total,
        yourOrdinal: yourOrdinal > 0 ? yourOrdinal : null,
        username,
        tier,
        roll,
        mocked: false,
      };
    },

    async press() {
      await ensureMapped();

      // .tx() dry-runs first, so a revert (AlreadyPressed, NotHuman) surfaces
      // here as a decoded error rather than costing gas.
      step('signing');
      await withTimeout(contract.press.tx(), TX_TIMEOUT_MS, 'press transaction');

      step('confirming');
      const snap = await withTimeout(
        contract.snapshot.query(h160Address, QUERY),
        QUERY_TIMEOUT_MS,
        'snapshot after press',
      );
      if (!snap.success) throw describeFailure('snapshot after press', snap.value);
      return toNumber(pick(snap.value, 1, 'yourOrdinal'));
    },
  };
}
