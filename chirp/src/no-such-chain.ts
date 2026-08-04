/**
 * A stand-in for the chain descriptors chirp can never ask for.
 *
 * WHAT THIS SAVES. The published bundle was 6.8 MB, and 5.1 MB of it was chain
 * metadata — eight descriptor blobs, most around 850 kB. Only three are for
 * chains this app talks to. In an ordinary browser the rest cost nothing much:
 * the SDK reaches most of them through `import()` and an unused one is never
 * fetched. Through the dot.li gateway they cost everything, because the gateway
 * pulls the WHOLE published archive from an IPFS gateway before the first line
 * of the app runs. Every reader on the web was downloading Kusama's metadata to
 * look at a timeline on the devnet.
 *
 * WHY IT IS SAFE. `@parity/product-sdk-chain-client` picks descriptors in
 * `loadDescriptors(env)`, a plain object of one lazy loader per environment:
 * polkadot, kusama, paseo, devnet. Only the branch matching the environment
 * runs. chirp passes `environment: 'devnet'` at its single call site
 * (src/probe.ts) and imports `devnet-asset-hub` directly everywhere else — it
 * has no code path that reaches the other three environments.
 *
 * `paseo_bulletin` is the one that is not lazy: cloud-storage imports it at the
 * top of its module, so its 251 kB shipped on every load whether or not anything
 * touched Paseo. Stubbing is the only way to drop that one at all.
 *
 * AND IF ANY OF THAT IS EVER WRONG, this says so. A stub that returned an empty
 * object would surface as a metadata decoding failure hundreds of lines from the
 * cause; every access here throws, naming the chain and the property asked for.
 */
const absent = (chain: string) =>
  new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return undefined;
      throw new Error(
        `chirp does not bundle the ${chain} metadata — something read "${String(prop)}" off it. ` +
        `Only the devnet descriptors ship; see src/no-such-chain.ts and the alias ` +
        `list in vite.config.ts, and drop the chain from that list if it is now ` +
        `genuinely needed.`,
      );
    },
  });

export const polkadot_asset_hub = absent('polkadot-asset-hub');
export const kusama_asset_hub = absent('kusama-asset-hub');
export const paseo_asset_hub = absent('paseo-asset-hub');
export const paseo_bulletin = absent('paseo-bulletin');
export const paseo_individuality = absent('paseo-individuality');
export default absent('an unbundled chain');
