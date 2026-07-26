/**
 * Production configuration.
 *
 * DEMO_ENABLED gates every demo affordance in the app (the banner and the
 * local driver). Personhood is granted to a small set of accounts on this
 * devnet, so demo stays on; when personhood opens to everyone, flip this to
 * false and rebuild — the demo entry points disappear and only the live
 * chain path remains.
 */
export const DEMO_ENABLED = true;

/** Deployed Discreet contract on the devnet Asset Hub (verified live). */
export const DISCREET_CONTRACT = '0x8Fa1fcA9f6E8C333625c3caf064E94640175f375';

/** Public devnet Asset Hub Ethereum RPC (read-only, no wallet). */
export const DEVNET_EVM_RPC = 'https://paseo-assethub-rpc.laissez-faire.trade';
