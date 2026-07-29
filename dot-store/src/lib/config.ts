/** dot-store: a storefront for .dot apps, with reviews that live on chain. */

/** AppReviews, deployed on the devnet Asset Hub. Reviews of .dot apps. */
export const APP_REVIEWS = '0xE4D0485C6e2C7db54C8f14A1620992Be98eDFEC3';

export const DEVNET_EVM_RPC = 'https://paseo-assethub-rpc.laissez-faire.trade';

/** The one IPFS gateway that actually serves devnet CIDs (icons). */
export const GATEWAY = 'https://devnet-ipfs.api.polkadotcommunity.foundation';

/**
 * Reviews are OPEN on this devnet: the contract ships with `minStatus = 0`, so
 * anyone can post and a review is keyed on the wallet address rather than on a
 * personhood alias. Those reviews are labelled unverified everywhere they
 * appear — a fresh wallet is one reviewer, not one human. Raising `minStatus`
 * on the contract (owner-only, no redeploy) is what makes mainnet reviews
 * one-per-human, and this flag stops being needed.
 */
export const DEMO_ENABLED = true;

/**
 * Appended when opening an app: it tells the shell to resolve through the RPC
 * gateway instead of the light client. Without it the app sits on a slow
 * "Fetching content" screen — the same finding that made our screenshot
 * pipeline work.
 */
export const OPEN_HINT = 'chainBackend=rpc-gateway';
