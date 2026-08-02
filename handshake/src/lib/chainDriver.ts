import {
  createContract,
  createContractRuntimeFromClient,
  ensureContractAccountMapped,
  QUERY_FALLBACK_ORIGIN,
} from '@parity/product-sdk/contracts';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { ChainDefinition, HexString, PolkadotClient, PolkadotSigner } from 'polkadot-api';
import { HANDSHAKE_ABI } from './abi';
import { CONTRACT_ADDRESS } from './config';
import type { AgreementRow, AgreementState, HandshakeDriver, KeptWord, MyState } from './types';

const MINE_LIMIT = 20n;

const CONNECT_TIMEOUT_MS = 30_000;
// The host's light client cold-syncs on first visit and can crash-recover
// mid-session; the first load has to outwait both, visibly.
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

const ZERO_ALIAS = '0x' + '0'.repeat(64);
const STATES: AgreementState[] = ['proposed', 'accepted', 'sealed', 'completed', 'withdrawn'];

function toRow(value: unknown, id: number): AgreementRow {
  const acceptor = String(pick(value, 1, 'acceptor') ?? ZERO_ALIAS);
  return {
    id,
    proposer: String(pick(value, 0, 'proposer') ?? ''),
    acceptor: acceptor.toLowerCase() === ZERO_ALIAS ? null : acceptor,
    proposerTier: toNumber(pick(value, 2, 'proposerTier')),
    acceptorTier: toNumber(pick(value, 3, 'acceptorTier')),
    createdAt: toNumber(pick(value, 4, 'createdAt')),
    sealedAt: toNumber(pick(value, 5, 'sealedAt')),
    completedAt: toNumber(pick(value, 6, 'completedAt')),
    state: STATES[toNumber(pick(value, 7, 'state'))] ?? 'proposed',
    proposerDone: Boolean(pick(value, 8, 'proposerDone')),
    acceptorDone: Boolean(pick(value, 9, 'acceptorDone')),
    terms: String(pick(value, 10, 'terms') ?? ''),
  };
}

function toKeptWord(value: unknown): KeptWord {
  return {
    sealed: toNumber(pick(value, 0, 'sealedCount')),
    completed: toNumber(pick(value, 1, 'completedCount')),
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
  account: string;
  h160Address: HexString;
  username: string | null;
  /**
   * The signer for `account` — resolved in `lib/signer.ts` from the user's own
   * wallet accounts, or (fallback) from the app-scoped product account. Passed
   * as a plain `PolkadotSigner` rather than a `SignerManager` on purpose: a
   * manager built with `{ dappName }` always resolves to the app-scoped account,
   * which nobody can fund from the wallet UI.
   */
  signer: PolkadotSigner;
  onStep?: (step: string) => void;
}

export async function createChainDriver(options: ChainDriverOptions): Promise<HandshakeDriver> {
  const { chain, account, h160Address, username, signer, onStep } = options;
  const step = (message: string) => onStep?.(message);

  step('connecting via host api');
  await withTimeout(chain.connect({ assetHub: devnet_asset_hub }), CONNECT_TIMEOUT_MS, 'chain connect');

  step('preparing contract');
  const client = chain.getRawClient(devnet_asset_hub);
  const runtime = createContractRuntimeFromClient(client, devnet_asset_hub);
  // `defaultSigner` / `defaultOrigin` are the static equivalents of what the
  // signer manager used to supply — every `.tx()` is signed and paid by the
  // account we picked, and reads still override the origin explicitly below.
  const contract = createContract(runtime, CONTRACT_ADDRESS as HexString, HANDSHAKE_ABI, {
    defaultSigner: signer,
    defaultOrigin: account,
  });

  // Reads never run as the user (AccountUnmapped otherwise — see thebutton/README.md).
  const QUERY = { origin: QUERY_FALLBACK_ORIGIN };

  let mapped = false;
  async function ensureMapped(): Promise<void> {
    if (mapped) return;
    step('preparing your account');
    const result = await withTimeout(
      ensureContractAccountMapped(runtime, account, signer),
      TX_TIMEOUT_MS,
      'account mapping',
    );
    if (!result.ok) throw new Error(`account mapping failed: ${String(result.error)}`);
    mapped = true;
  }

  async function readMe(): Promise<MyState> {
    const result = await withTimeout(contract.me.query(h160Address, 0n, QUERY), QUERY_TIMEOUT_MS, 'me');
    if (!result.success) throw describeFailure('me', result.value);
    return {
      tier: toNumber(pick(result.value, 0, 'status')),
      alias: String(pick(result.value, 1, 'yourAlias') ?? ''),
      username,
      record: toKeptWord(pick(result.value, 3, 'yourRecord')),
    };
  }

  async function getOne(id: number): Promise<AgreementRow> {
    const result = await withTimeout(contract.get.query(BigInt(id), QUERY), QUERY_TIMEOUT_MS, 'get');
    if (!result.success) throw describeFailure('get', result.value);
    return toRow(result.value, id);
  }

  async function submit(method: string, id: number): Promise<void> {
    await ensureMapped();
    step('waiting for your signature');
    await withTimeout(contract[method].tx(BigInt(id)), TX_TIMEOUT_MS, `${method} transaction`);
  }

  return {
    mocked: false,

    async myAgreements() {
      step('reading your standing');
      const me = await retry(readMe, LOAD_ATTEMPTS, LOAD_RETRY_DELAY_MS, (attempt) =>
        step(`the network is still waking up — retry ${attempt} of ${LOAD_ATTEMPTS - 1}`),
      );

      step('finding your agreements');
      const idsResult = await withTimeout(
        contract.mine.query(me.alias, 0n, MINE_LIMIT, QUERY),
        QUERY_TIMEOUT_MS,
        'mine',
      );
      if (!idsResult.success) throw describeFailure('mine', idsResult.value);
      const ids = Array.isArray(idsResult.value) ? idsResult.value.map(toNumber) : [];

      const rows: AgreementRow[] = [];
      for (const id of ids) {
        rows.push(await getOne(id));
      }
      return { rows, me };
    },

    getOne,

    async recordOf(alias: string) {
      const result = await withTimeout(
        contract.recordOf.query(alias, QUERY),
        QUERY_TIMEOUT_MS,
        'recordOf',
      );
      if (!result.success) throw describeFailure('recordOf', result.value);
      return toKeptWord(result.value);
    },

    async propose(terms: string) {
      await ensureMapped();
      step('waiting for your signature');
      await withTimeout(contract.propose.tx(terms), TX_TIMEOUT_MS, 'propose transaction');

      step('confirming');
      const total = await withTimeout(contract.count.query(QUERY), QUERY_TIMEOUT_MS, 'count');
      if (!total.success) throw describeFailure('count', total.value);
      return Math.max(0, toNumber(total.value) - 1);
    },

    accept: (id) => submit('accept', id),
    seal: (id) => submit('seal', id),
    withdraw: (id) => submit('withdraw', id),
    markDone: (id) => submit('markDone', id),
  };
}
