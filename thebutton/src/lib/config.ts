/**
 * Devnet constants, taken from the Polkadot Products address reference:
 * https://docs.polkadotcommunity.foundation/reference/addresses/
 */
export const DEVNET = {
  /** EVM chain id of Asset Hub, where contracts live. */
  assetHubEvmChainId: 420420417,
  ss58Prefix: 42,
  /** Fixed personhood precompile. */
  personhoodPrecompile: '0x000000000000000000000000000000000a010000',
  cdmRegistry: '0x59b0245778917af55224e5f8fb55f7f8d452619f',
  dotnsRegistry: '0x527b08a640b527a3dae0C4BE04D7344E430B6E50',
  browsePublisher: '0xaab42efbe8ea4d4228c3a11e973f94c17b9a0f2c',
  webGateway: 'dev-dot.li',
} as const;

/** Used by ProductSDKProvider for storage namespacing and account derivation. */
export const APP_NAME = 'thebutton';

/** Alias derivation context. Must match the CONTEXT the contract was deployed with. */
export const CONTEXT = 'thebutton.dot';

/**
 * Deployed TheButton address. Set VITE_BUTTON_ADDRESS in .env once the contract
 * is on chain. While unset the app runs against a local mock so the UI is
 * fully explorable without a deployment.
 */
export const BUTTON_ADDRESS = import.meta.env.VITE_BUTTON_ADDRESS as string | undefined;

/** Personhood tiers as reported by the precompile. */
export const TIER = { none: 0, lite: 1, full: 2 } as const;

/**
 * Minimum tier this frontend expects. Keep in sync with the contract's
 * MIN_STATUS — the contract is the real gate, this only drives the UI copy.
 *
 * Must be `full`. `lite` only means "registered a username", which any number of
 * fresh accounts can do, so accepting it would let one human press repeatedly
 * and defeat the entire premise of the app.
 */
export const MIN_TIER: number = TIER.full;
