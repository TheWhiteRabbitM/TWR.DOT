/**
 * On-chain configuration for the live (non-demo) mode.
 *
 * The ReviewRegistry contract is deployed and verified on the devnet Asset Hub;
 * a plain eth_call confirmed placeCount()=0, CONTEXT=keccak256("truereviews.dot"),
 * MIN_STATUS=1. Wiring the in-host chain driver (read reviews on-chain; write a
 * review = upload text to Bulletin for the CID, then call review() signed by the
 * user's personhood account) is the next step — the write path needs testing
 * inside the Polkadot host, exactly like OpenPetition's.
 */
export const REVIEW_REGISTRY = '0x29aF38913652B32989D1d96C51Af641980E55698';

/** keccak256("truereviews.dot") — the personhood alias context. */
export const CONTEXT_HASH = '0xb7bd873b91c8e8f217c9a400c20ca41e88008f4f9b30f1f171753d2561a53d6a';

/** Public devnet Asset Hub Ethereum RPC (read-only, no wallet). */
export const DEVNET_EVM_RPC = 'https://paseo-assethub-rpc.laissez-faire.trade';

export const MIN_STATUS = 1;
