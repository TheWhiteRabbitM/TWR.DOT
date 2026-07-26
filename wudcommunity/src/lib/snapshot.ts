import baked from './holders.json';

/**
 * The holder leaderboard, served from Bulletin instead of baked into the bundle.
 *
 * The snapshot is a full pass over 221k accounts (indexer/holders.mjs) — it can
 * only be regenerated off-chain, then it's a static artifact. As a Bulletin
 * object the page fetches it at runtime, so refreshing the leaderboard is
 * "re-run the indexer, upload, done" with no site rebuild. The baked copy stays
 * as the always-available fallback, so the page never depends on the fetch.
 */
export interface Tier {
  key: string;
  label: string;
  emoji: string;
  minShare: number;
  count: number;
  total: number;
}

export interface TopHolder {
  rank: number;
  address: string;
  amount: number;
  share: number;
  tier: string;
}

export interface Snapshot {
  supply: number;
  holders: number;
  top10Share: number;
  tiers: Tier[];
  top: TopHolder[];
  updatedAt: string;
}

export const SNAPSHOT_CID = 'bafybeiaum3mldcrwk4663p7wji5pinzatqs4tpxmqy4afys6p4ybqv2adi';

export const BAKED = baked as unknown as Snapshot;

const GATEWAYS = [
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
];

const FETCH_TIMEOUT_MS = 8_000;

export type SnapshotSource = 'bulletin' | 'baked';

function looksValid(v: unknown): v is Snapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Snapshot;
  return typeof s.supply === 'number' && Array.isArray(s.tiers) && Array.isArray(s.top);
}

/**
 * Load the snapshot from Bulletin, falling back to the baked copy on any
 * failure. Always resolves.
 */
export async function loadSnapshot(): Promise<{ snap: Snapshot; source: SnapshotSource }> {
  if (SNAPSHOT_CID.startsWith('__')) return { snap: BAKED, source: 'baked' };
  const attempts = GATEWAYS.map(async (toUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(toUrl(SNAPSHOT_CID), { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      if (!looksValid(json)) throw new Error('bad shape');
      return json;
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    const snap = await Promise.any(attempts);
    return { snap, source: 'bulletin' };
  } catch {
    return { snap: BAKED, source: 'baked' };
  }
}
