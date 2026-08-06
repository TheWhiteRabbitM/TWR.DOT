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

/**
 * ONE IDENTITY, ONE APP NAME.
 *
 * The host derives a different account per app name, so every app in this
 * ecosystem must ask for the SAME one or the same person ends up as two.
 * chirp's own header says this in as many words, and dotmail spent an evening
 * proving it the hard way: asking for `dotmailbox.dot` made this app a
 * different human being from the one holding the mask, so no key could ever be
 * published against it and no letter could ever be addressed to it.
 *
 * Changing this string changes who you are. It is not this app's name; it is
 * the ecosystem's.
 */
export const IDENTITY_DAPP = 'peoplebook.dot';

type Conn = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdk: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host: any;
  /** The typed api, for wrapping a call in Proxy.proxy. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any;
  /** The account this app acts as. The SAME one chirp acts as, by construction. */
  address: string | null;
  /** Bound on the contract as `signerManager`, which is what actually raises
   *  the wallet sheet. `getProductAccountSigner` never does, so a write signed
   *  with it hangs until it times out rather than asking anybody anything. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manager: any;
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
    const api = client.getTypedApi(descriptors.devnet_asset_hub);

    // The signer, chirp's way. A SignerManager asked for the ECOSYSTEM's app
    // name, so the host derives the same account chirp gets, which is the one
    // that owns the mask.
    let address: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manager: any = null;
    try {
      const signerPkg = await import('@parity/product-sdk-signer');
      manager = new signerPkg.SignerManager({ dappName: IDENTITY_DAPP });
      await manager.connect().catch(() => undefined);
      const deadline = Date.now() + 12_000;
      for (;;) {
        const st = manager.getState();
        let acc = st.selectedAccount ?? null;
        if (!acc && st.accounts[0]) {
          const picked = manager.selectAccount(st.accounts[0].address);
          if (picked.ok) acc = picked.value;
        }
        if (acc) { address = acc.address; break; }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { manager = null; }

    return { rt, sdk, host, api, address, manager };
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
