import {
  createContract,
  createContractRuntimeFromClient,
  ensureContractAccountMapped,
  QUERY_FALLBACK_ORIGIN,
} from '@parity/product-sdk/contracts';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { SignerManager } from '@parity/product-sdk-signer';
import type { ChainDefinition, HexString, PolkadotClient } from 'polkadot-api';
import { OPENPETITION_ABI } from './abi';
import { CONTRACT_ADDRESS } from './config';
import type { MyState, PetitionRow, PetitionsDriver } from './types';

/** Largest register page fetched in one read. */
const PAGE = 200n;

const CONNECT_TIMEOUT_MS = 30_000;
// The host's light client cold-syncs on first visit and can crash-recover
// mid-session (smoldot panics are a known host bug); a register load has to
// outwait both, visibly, rather than fail at the first 20s.
const QUERY_TIMEOUT_MS = 30_000;
const TX_TIMEOUT_MS = 120_000;
const LOAD_ATTEMPTS = 4;
const LOAD_RETRY_DELAY_MS = 2_500;

/** Every await is bounded — a hang must become a named error, not a spinner. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Retry a transient chain failure (host light client re-establishing). */
async function retry<T>(
  operation: () => Promise<T>,
  attempts: number,
  delayMs: number,
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
        await new Promise((r) => setTimeout(r, delayMs * attempt));
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

/** Struct decodes arrive positional or named depending on the decoder. */
function pick(value: unknown, index: number, name: string): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === 'object') return (value as Record<string, unknown>)[name];
  return undefined;
}

function toRow(value: unknown, id: number): PetitionRow {
  return {
    id,
    author: String(pick(value, 0, 'author') ?? ''),
    createdAt: toNumber(pick(value, 1, 'createdAt')),
    fullCount: toNumber(pick(value, 2, 'fullCount')),
    liteCount: toNumber(pick(value, 3, 'liteCount')),
    title: String(pick(value, 4, 'title') ?? ''),
    bodyCid: String(pick(value, 5, 'bodyCid') ?? ''),
  };
}

function describeFailure(method: string, value: unknown): Error {
  return new Error(`${method} failed on chain: ${JSON.stringify(value ?? null)}`);
}

/** The subset of the SDK's `App.chain` this driver needs. */
export interface ChainAccess {
  connect(chains: Record<string, ChainDefinition>): Promise<unknown>;
  getRawClient(descriptor: ChainDefinition): PolkadotClient;
}

export interface ChainDriverOptions {
  chain: ChainAccess;
  /** SS58 address of the signed-in account (tx signing + mapping). */
  account: string;
  /** EVM address of the same account — what `me(address, id)` actually takes. */
  h160Address: HexString;
  username: string | null;
  signerManager: SignerManager;
  onStep?: (step: string) => void;
}

export async function createChainDriver(options: ChainDriverOptions): Promise<PetitionsDriver> {
  const { chain, account, h160Address, username, signerManager, onStep } = options;
  const step = (message: string) => onStep?.(message);

  step('connecting via host api');
  await withTimeout(chain.connect({ assetHub: devnet_asset_hub }), CONNECT_TIMEOUT_MS, 'chain connect');

  step('preparing contract');
  const client = chain.getRawClient(devnet_asset_hub);
  const runtime = createContractRuntimeFromClient(client, devnet_asset_hub);
  const contract = createContract(runtime, CONTRACT_ADDRESS as HexString, OPENPETITION_ABI, {
    signerManager,
  });

  // Read-only dry-runs must never run as the user: pallet-revive rejects
  // unmapped origins, and a fresh account is always unmapped. See
  // thebutton/README.md ("Queries must not run as the user").
  const QUERY = { origin: QUERY_FALLBACK_ORIGIN };

  // Mapping is lazy: only the transaction paths need it, and it submits a
  // transaction itself, so it must never run during a read.
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
    if (!result.ok) throw new Error(`account mapping failed: ${String(result.error)}`);
    mapped = true;
  }

  async function readMe(id: bigint): Promise<{ me: MyState; signedTier: number }> {
    const result = await withTimeout(contract.me.query(h160Address, id, QUERY), QUERY_TIMEOUT_MS, 'me');
    if (!result.success) throw describeFailure('me', result.value);
    return {
      me: {
        tier: toNumber(pick(result.value, 0, 'status')),
        alias: String(pick(result.value, 1, 'yourAlias') ?? ''),
        username,
      },
      signedTier: toNumber(pick(result.value, 2, 'signedTier')),
    };
  }

  return {
    mocked: false,

    async list() {
      step('reading register');
      const page = await retry(
        () => withTimeout(contract.page.query(0n, PAGE, QUERY), QUERY_TIMEOUT_MS, 'page'),
        LOAD_ATTEMPTS,
        LOAD_RETRY_DELAY_MS,
        (attempt) => step(`the network is still waking up — retry ${attempt} of ${LOAD_ATTEMPTS - 1}`),
      );
      if (!page.success) throw describeFailure('page', page.value);

      const rows = Array.isArray(page.value)
        ? page.value.map((entry, index) => toRow(entry, index)).reverse()
        : [];

      step('reading your standing');
      const { me } = await readMe(0n);
      return { rows, me };
    },

    async signedTier(id: number) {
      const { signedTier } = await readMe(BigInt(id));
      return signedTier;
    },

    async sign(id: number) {
      await ensureMapped();
      step('signing');
      // .tx() dry-runs first: AlreadySigned / NotHuman surface as decoded
      // errors before any gas is spent.
      await withTimeout(contract.sign.tx(BigInt(id)), TX_TIMEOUT_MS, 'sign transaction');
    },

    async create(title: string) {
      await ensureMapped();
      step('submitting petition');
      await withTimeout(contract.create.tx(title, ''), TX_TIMEOUT_MS, 'create transaction');

      step('confirming');
      const total = await withTimeout(contract.count.query(QUERY), QUERY_TIMEOUT_MS, 'count');
      if (!total.success) throw describeFailure('count', total.value);
      // Latest id. On a busy chain this could race another creation; on devnet
      // the worst case is landing on a neighbour's brand-new petition.
      return Math.max(0, toNumber(total.value) - 1);
    },
  };
}
