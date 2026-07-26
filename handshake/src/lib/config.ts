/** Devnet constants. See thebutton/README.md for provenance. */
export const DEVNET = {
  assetHubEvmChainId: 420420417,
  personhoodPrecompile: '0x000000000000000000000000000000000a010000',
  ethRpc: 'https://paseo-assethub-rpc.laissez-faire.trade',
} as const;

/** Used for storage namespacing and product-account derivation. */
export const APP_NAME = 'handshake';

/** Canonical public host (the gateway serves any browser, no account needed). */
export const PUBLIC_HOST = 'https://handshake.dev-dot.li';

/**
 * Deployed Handshake contract on devnet Asset Hub. Set after each deploy;
 * verified on-chain before publishing.
 */
export const CONTRACT_ADDRESS = (import.meta.env.VITE_HANDSHAKE_ADDRESS ??
  '0x373aD399586EfABA4BF04E88cfC3BEDE7Fd81214') as string;

/** Personhood tiers. */
export const TIER = { none: 0, lite: 1, full: 2 } as const;

/** Terms limits — keep in sync with the contract. */
export const TERMS_MIN = 8;
export const TERMS_MAX = 500;
