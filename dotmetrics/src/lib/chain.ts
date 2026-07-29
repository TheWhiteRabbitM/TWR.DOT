import { useSyncExternalStore } from 'react';
import { Contract, JsonRpcProvider } from 'ethers';
import type { ReadContract } from './types';

/**
 * Public Ethereum JSON-RPC for devnet Asset Hub. Everything dotmetrics shows is
 * read through here — no wallet, no host container, no personhood. Runs in any
 * browser.
 *
 * WHY THERE IS MORE THAN ONE ENDPOINT. This page is the .dot ecosystem's index:
 * with a single endpoint, one provider having a bad afternoon takes down every
 * number on the page at once, and a reader has no way to tell "the ecosystem is
 * empty" from "we could not ask". The list below is ORDERED — the endpoint the
 * devnet docs publish leads it — and a read walks it on failure, in order.
 *
 * Three rules make the walk safe rather than merely stubborn:
 *
 *   1. BOUNDED. One read tries each endpoint AT MOST ONCE, and every attempt is
 *      capped at {@link ATTEMPT_TIMEOUT_MS}. The worst case is arithmetic, not a
 *      hope: three endpoints, so at most three attempts and ~12 seconds. There
 *      is no retry loop anywhere in this file.
 *   2. VERIFIED. An endpoint is used only once it has proved which chain it is
 *      ({@link CHAIN_ID}). Falling back onto a DIFFERENT chain would be worse
 *      than an outage: `registry.owner()` would answer zero for every real name
 *      and this index would quietly report the ecosystem empty.
 *   3. DISCLOSED. Falling back is not free and is not hidden. {@link rpcHealth}
 *      says which endpoint is answering and whether that is the first choice, so
 *      the page's status line can tell the reader it is on a spare — see
 *      `hero.rpcFallback` in the dictionary.
 *
 * All three endpoints were tested before being listed here, not assumed: same
 * `eth_chainId` (0x190f1b41), identical `registry.owner()` and
 * `resolver.text()` answers at the same block height, JSON-RPC batch support
 * (ethers batches by default), and `Access-Control-Allow-Origin: *`, without
 * which a browser could not call them at all.
 */
export const RPC_ENDPOINTS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
] as const;

/** The chain every endpoint above must answer for. See rule 2. */
const CHAIN_ID = 420420417n;

/**
 * The budget for ONE attempt against ONE endpoint. Deliberately short: a hung
 * endpoint must cost the reader a moment, not the page. Three of these is the
 * whole worst case of a read.
 */
const ATTEMPT_TIMEOUT_MS = 4_000;

const host = (index: number): string => new URL(RPC_ENDPOINTS[index]).host;

/** What the reader is owed about where these numbers came from. */
export interface RpcHealth {
  /**
   * Which endpoint is answering, 1-based, out of `total` — a position with its
   * denominator, so "2 of 3" can be said instead of a bare ordinal.
   */
  using: number;
  total: number;
  /** Its hostname: short enough to print in a status line. */
  host: string;
  /** True whenever reads are coming from anything but the first choice. */
  degraded: boolean;
}

/** Index into {@link RPC_ENDPOINTS} that reads start from. */
let active = 0;
const providers: (JsonRpcProvider | undefined)[] = [];
/**
 * Per endpoint: undefined = chain not checked yet, true = proved to be
 * {@link CHAIN_ID}, false = proved to be something else and never used again.
 */
const rightChain: (boolean | undefined)[] = [];

const listeners = new Set<() => void>();
/**
 * Cached because {@link useRpcHealth} feeds it to `useSyncExternalStore`, which
 * compares snapshots by identity: a fresh object per call would re-render for
 * ever. Recomputed only when the answer actually changes.
 */
let health: RpcHealth = computeHealth();

function computeHealth(): RpcHealth {
  return {
    using: active + 1,
    total: RPC_ENDPOINTS.length,
    host: host(active),
    degraded: active !== 0,
  };
}

function announce(): void {
  health = computeHealth();
  for (const fn of listeners) fn();
}

/** Which endpoint is answering right now, and whether that is the first choice. */
export function rpcHealth(): RpcHealth {
  return health;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Subscribe a component to {@link rpcHealth}, so a failover re-renders the status line. */
export function useRpcHealth(): RpcHealth {
  return useSyncExternalStore(subscribe, rpcHealth, rpcHealth);
}

/** The plain-language part of an error, without a stack a reader cannot use. */
function say(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return String(e?.shortMessage ?? e?.message ?? error);
}

/**
 * Cap one attempt. The loser of the race is still handled by `Promise.race`, so
 * a late rejection cannot surface as an unhandled error.
 */
function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} did not answer within ${ATTEMPT_TIMEOUT_MS / 1000}s`)),
        ATTEMPT_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * A revert is the CHAIN answering, not the endpoint failing — every other
 * endpoint would revert identically. Failing over on one would spend the whole
 * list on a call that can never succeed, and would turn one clear answer into
 * three vague ones.
 */
function isChainAnswer(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'CALL_EXCEPTION';
}

/** The endpoint at `index`, once it has proved it is the chain we mean. */
async function verified(index: number): Promise<JsonRpcProvider> {
  const provider = (providers[index] ??= new JsonRpcProvider(RPC_ENDPOINTS[index], undefined, {
    staticNetwork: true,
  }));
  if (rightChain[index] === undefined) {
    // `staticNetwork` makes ethers ask for the chain id once and cache it, so
    // this is the request it was going to make anyway — we just look at the
    // answer instead of trusting it. A TIMEOUT here leaves the verdict
    // undefined on purpose: not answering is not evidence of being the wrong
    // chain, and the endpoint gets another chance on the next read.
    const network = await withDeadline(provider.getNetwork(), host(index));
    rightChain[index] = network.chainId === CHAIN_ID;
    if (!rightChain[index]) {
      console.warn(
        `[rpc] ${host(index)} answers for chain ${network.chainId}, not the .dot devnet ` +
          `(chain ${CHAIN_ID}) — it will not be used again during this visit, because reading ` +
          `.dot names off the wrong chain would report every real app as unregistered.`,
      );
    }
  }
  if (!rightChain[index]) throw new Error(`${host(index)} is a different chain`);
  return provider;
}

/**
 * Run one read against the remembered endpoint, then against each of the others
 * once, until one answers. Bounded by construction — see rule 1 above.
 *
 * The endpoint that answers is remembered for the rest of this visit, so a
 * failover costs one slow read rather than one per read. It is remembered in
 * memory only, NOT in storage: a fresh load starts at the documented endpoint
 * again, because a fallback that outlives the outage would hide a primary that
 * has since recovered.
 *
 * THROWS when every endpoint refuses, with a sentence naming each one and what
 * it did. It never resolves to a zero — "we could not ask" and "the answer is
 * none" are different claims and the caller decides what each one means.
 */
async function withFailover<T>(
  what: string,
  run: (provider: JsonRpcProvider) => Promise<T>,
): Promise<T> {
  const from = active;
  const trail: string[] = [];
  for (let step = 0; step < RPC_ENDPOINTS.length; step += 1) {
    const index = (from + step) % RPC_ENDPOINTS.length;
    try {
      const value = await withDeadline(run(await verified(index)), host(index));
      if (index !== active) {
        active = index;
        console.warn(
          `[rpc] ${host(from)} failed, ${host(index)} answered — every read on this page now ` +
            `goes there for the rest of this visit. Reload once the first endpoint is back.`,
        );
        announce();
      }
      return value;
    } catch (error) {
      if (isChainAnswer(error)) throw error;
      trail.push(`${host(index)} — ${say(error)}`);
    }
  }
  throw new Error(
    `could not read ${what}: all ${RPC_ENDPOINTS.length} .dot rpc endpoints refused it ` +
      `(${trail.join(' · ')})`,
  );
}

/** A contract reader with endpoint failover, matching {@link ReadContract}. */
export const readContract: ReadContract = (address, abi) => {
  return new Proxy(
    {},
    {
      get(_t, method: string) {
        return (...args: unknown[]) =>
          // The Contract is bound per attempt because each attempt may be a
          // different provider; the ABI here is one or two fragments, so this
          // is cheaper than the round trip it precedes.
          withFailover(`${method}() on ${address}`, (provider) =>
            new Contract(address, abi, provider).getFunction(method)(...args),
          );
      },
    },
  ) as ReturnType<ReadContract>;
};

/**
 * Is ANY endpoint reachable? Used for the connection indicator, which carries a
 * boolean — so the sentence saying which endpoints failed and how is logged
 * here rather than thrown away. Whether the answer came from a spare is a
 * separate question, and {@link rpcHealth} is where it is asked.
 */
export async function ping(): Promise<boolean> {
  try {
    await withFailover('the chain head', (provider) => provider.getBlockNumber());
    return true;
  } catch (error) {
    console.warn('[rpc]', say(error));
    return false;
  }
}
