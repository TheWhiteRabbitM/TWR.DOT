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
  'node/2891910953': '0x1c572cc012ba399fdc202c6ec5cb557ed3563aa6801ae58d70b7feab5f637f28',
  'node/1401903456': '0xe9b86d0f1c25f82fae334a0d85fcc7ec7609509391cbc966fcc94b63d88669bc',
  'node/302985663': '0x1f43e1de5722e249b95008a93c175349b482d1208e59533906991ca403ac4be4',
  'node/998877665': '0xec9b64366bf37f2a5fefda7df94500cc248f2215e47783feedf397ac9dcd7091',
  'node/553311228': '0x076d67f16d5ae8c9104f3363c6315ca934e1caecf609a7b7ab71803df4864065',
  'way/138121600': '0xd1d5d5d4cbe4df7ed7af35094ac5a7ad2877bfbf423c969cf2c23e584871233f',
  'node/4113166188': '0xfaa5bfae067330298f4213080ba1170ac8025e99851a7696ac90eb51f615bc89',
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
