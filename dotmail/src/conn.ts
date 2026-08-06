/**
 * conn.ts — one connection to the chain, for the whole app.
 *
 * WHY THIS EXISTS
 *   names.ts built a fresh client on every lookup: `createClient(await
 *   getHostProvider(...))`, once per call. Meanwhile ContractStore already held
 *   one. The second client never came up, so `maskOfHandle` sat there forever
 *   while DotMail reads on the first client worked perfectly — which is exactly
 *   what the screen showed: "Letters are on Asset Hub" at the top, and a handle
 *   lookup that timed out below it.
 *
 *   A host provider is not a pool. Opening it twice is not twice the throughput,
 *   it is one working connection and one that hangs.
 *
 * IT IS CACHED AS A PROMISE, NOT AS A RESULT
 *   So two callers racing at startup share the one attempt rather than starting
 *   a second while the first is still in flight.
 */
export const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' as const;

type Conn = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdk: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host: any;
};

let pending: Promise<Conn | null> | null = null;

async function connect(): Promise<Conn | null> {
  try {
    const host = await import('@parity/product-sdk-host');
    const { createClient } = await import('polkadot-api');
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const sdk = await import('@parity/product-sdk/contracts');

    const provider = await host.getHostProvider(GENESIS);
    if (!provider) return null;

    const client = createClient(provider as never);
    const rt = sdk.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
    return { rt, sdk, host };
  } catch {
    return null;
  }
}

/** The shared connection. Every contract in this app hangs off this one. */
export function sharedChain(): Promise<Conn | null> {
  if (!pending) pending = connect();
  return pending;
}

/** Forget it, so the next caller tries again. Used when a read fails in a way
 *  that suggests the connection itself is gone, rather than the answer. */
export function dropChain() {
  pending = null;
}

/**
 * A read that cannot hang forever.
 *
 * "I pressed it and nothing happened" is what an unresolved promise looks like
 * from a chair, and it is indistinguishable from a broken button.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

export const READ_MS = 15_000;
