import { REVIEW_REGISTRY, DEVNET_EVM_RPC } from './config';

/**
 * Live reads from the deployed ReviewRegistry — the app talks to its own smart
 * contract on every load, from any browser, with zero dependencies: hand-rolled
 * JSON-RPC eth_call with build-time-computed selectors (no ethers in the
 * bundle). Writing a review on-chain is personhood-gated by the contract
 * (MIN_STATUS=1) and signed inside the Polkadot host — reads are permissionless.
 */

// keccak-derived at build time — see the repo notes.
const SEL_PLACE_COUNT = '0x8778658a'; // placeCount()
const SEL_REVIEW_COUNT = '0x2891e4ce'; // reviewCount(bytes32)

/** keccak256(osmRef) for the seeded places, precomputed at build time. */
export const PLACE_KEYS: Record<string, string> = {
  'node/3123151652': '0xed9ffa94748b76c9887bda1c6c2ac36408cc7ad6d00d1ba7242c08660860f35a',
  'node/2246354459': '0x94e7de6aca387cdf1622f51246cd7b7560ad8f9de9836420eec3c58dc2c91255',
  'node/676820117': '0xfab5a3de23b7c7e5f32f7d69b38e3e820574a08caec6ab0f123916d118d4cb54',
  'node/619783817': '0xc0a6ae3e3179bcfa06b8f63af0750578a2d5305c79e44a2629ddf049dce8093b',
  'node/1833917665': '0x973d8fcc5767eb58d050e98a0917e4cd5244115d61212d67042000854289047e',
  'node/3450499385': '0x7b65503286322885105913a57763b01b12f3badd763e0257a73f3f34f01247b3',
  'node/2700446956': '0x9fa9f3987370996ccde3bf3914ea67e4b6fd27004be8af6a562dc951b722d33d',
};

async function ethCall(data: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(DEVNET_EVM_RPC, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: REVIEW_REGISTRY, data }, 'latest'],
      }),
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const j = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!j.result) throw new Error(j.error?.message ?? 'no result');
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

function toInt(hex: string): number {
  return Number.parseInt(hex, 16) || 0;
}

export interface OnChainStatus {
  /** Distinct places ever reviewed on-chain. */
  places: number;
}

/** One call, made on every app load. Throws if the RPC is unreachable. */
export async function readContractStatus(): Promise<OnChainStatus> {
  const out = await ethCall(SEL_PLACE_COUNT);
  return { places: toInt(out) };
}

/** On-chain review count for a place we know the key of (null if unknown/unreachable). */
export async function readOnChainReviews(osmRef: string): Promise<number | null> {
  const key = PLACE_KEYS[osmRef];
  if (!key) return null;
  try {
    const out = await ethCall(SEL_REVIEW_COUNT + key.slice(2));
    return toInt(out);
  } catch {
    return null;
  }
}
