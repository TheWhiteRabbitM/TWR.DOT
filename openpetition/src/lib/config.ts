/** Devnet constants. See thebutton/README.md for provenance. */
export const DEVNET = {
  assetHubEvmChainId: 420420417,
  personhoodPrecompile: '0x000000000000000000000000000000000a010000',
  ethRpc: 'https://paseo-assethub-rpc.laissez-faire.trade',
} as const;

/** Used for storage namespacing and product-account derivation. */
export const APP_NAME = 'openpetition';

/** Canonical public host (the gateway serves any browser, no account needed). */
export const PUBLIC_HOST = 'https://openpetition.dev-dot.li';

/**
 * Deployed OpenPetition contract on devnet Asset Hub. Set after each deploy;
 * verified by contract/scripts/verify-petitions.cjs.
 */
export const CONTRACT_ADDRESS = (import.meta.env.VITE_OPENPETITION_ADDRESS ??
  '0x9e195eeca2E3BAB0ffC236f51Fd6c4a0330C38E1') as string;

/** Personhood tiers. */
export const TIER = { none: 0, lite: 1, full: 2 } as const;

/** Title limits — keep in sync with the contract. */
export const TITLE_MIN = 8;
export const TITLE_MAX = 160;
