/**
 * chain.ts — one connection, shared by everything in this app.
 *
 * A host provider is not a pool. Opening it twice does not give twice the
 * throughput, it gives one connection that works and one that hangs forever
 * with no error, which is a failure mode that costs hours to recognise because
 * half the app keeps working.
 */
export const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' as const;

/** The registries this app reads. Masks is its own; the other two belong to the
 *  apps that sit on top of it, and are read, never written, from here. */
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
export const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';
export const DOTMAIL_KEYS = '0x9d03cc0f36d123f964b09cfb154458816817b5be';

/**
 * The one papi client, shared by every caller in this app.
 *
 * `claim.ts` opened its own in three separate places and this file opened a
 * fourth. Only the first works: the rest sit there for ever with no error,
 * which is why the register filled in normally while "Reading your mask from
 * the chain" never finished. Two halves of one page, one connection each,
 * and only one of them alive.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientPending: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hostClient(): Promise<any> {
  if (!clientPending) {
    clientPending = (async () => {
      const host = await import('@parity/product-sdk-host');
      const { createClient } = await import('polkadot-api');
      const provider = await host.getHostProvider(GENESIS);
      if (!provider) throw new Error('no host provider');
      return createClient(provider as never);
    })();
  }
  return clientPending;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Runtime = { rt: any; sdk: any };
let pending: Promise<Runtime | null> | null = null;

async function connect(): Promise<Runtime | null> {
  try {
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const sdk = await import('@parity/product-sdk/contracts');
    const client = await hostClient();
    return { rt: sdk.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub), sdk };
  } catch {
    return null;
  }
}

/** Cached as a PROMISE, so two callers racing at startup share one attempt. */
export function contractRuntime(): Promise<Runtime | null> {
  if (!pending) pending = connect();
  return pending;
}
