import { buildApps, excludedFrom, type Discovered } from './registry';
import type { AppEntry } from './types';

/**
 * The .dot app directory, served from Bulletin instead of baked into the JS
 * bundle.
 *
 * Why: the directory grows every time someone registers a .dot name. Baked into
 * the bundle, refreshing it meant re-running the indexer AND rebuilding AND
 * republishing the whole site. As a Bulletin object it is content-addressed data
 * the page fetches at runtime — byte's rule, "keep heavy data off the bundle,
 * on bulletin; it's just a hoster." Re-run the indexer, upload the new JSON, and
 * every visitor sees the new list.
 *
 * The CID is immutable, so it is pinned here at build time. Making the directory
 * updatable with NO rebuild at all is the next step: point a stable DotNS text
 * record at the latest CID and resolve that first. Until then the baked
 * snapshot is always the fallback, so the page never depends on a fetch.
 */
export const DIRECTORY_CID = 'bafybeifs2jw2fgit57n2l4kuxtlqcqfccxwzx4xh7yx62ix4p3hhm3kfhm';

/**
 * Public IPFS gateways that bridge the devnet Bulletin bitswap network. Raced,
 * not tried in series: gateway latency is wildly uneven and a slow one must not
 * hold up a fast one. First valid answer wins; if none answer we fall back to
 * the baked snapshot.
 */
const GATEWAYS = [
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
  (cid: string) => `https://${cid}.ipfs.cf-ipfs.com/`,
];

const FETCH_TIMEOUT_MS = 8_000;

export type DirectorySource = 'bulletin' | 'baked';

export interface DirectoryResult {
  apps: AppEntry[];
  source: DirectorySource;
  cid: string | null;
  /**
   * Labels the indexer's calldata scan proposed and `registry.owner()` rejected.
   * Disclosed, not hidden: they are the difference between what a byte scan can
   * see and what the registry actually holds.
   */
  excluded: string[];
}

/**
 * A value is a plausible discovered-app map: non-empty, every entry shaped
 * right, and every entry carrying the `owner` the registry confirmed.
 *
 * That last condition is deliberate. Directories published before the ghost
 * filter existed listed a third more names than the registry actually holds,
 * and they are still out there under their old CIDs. Without an owner on every
 * entry a directory is unverified data, and the baked snapshot — which is
 * verified — is the better answer.
 *
 * `excluded` sits beside the entries as a list of rejected labels, so it is
 * skipped rather than validated as one.
 */
function isDiscoveredMap(value: unknown): value is Record<string, Discovered> {
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) => key !== 'excluded',
  );
  if (entries.length === 0) return false;
  return entries.every(([, e]) => {
    if (!e || typeof e !== 'object') return false;
    const d = e as Record<string, unknown>;
    return (
      typeof d.label === 'string' &&
      typeof d.domain === 'string' &&
      typeof d.url === 'string' &&
      typeof d.firstSeenBlock === 'number' &&
      typeof d.owner === 'string' &&
      d.owner.length > 0
    );
  });
}

function fetchJsonRace(cid: string): Promise<Record<string, Discovered>> {
  const attempts = GATEWAYS.map(async (toUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(toUrl(cid), { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      if (!isDiscoveredMap(json)) throw new Error('unexpected shape');
      return json;
    } finally {
      clearTimeout(timer);
    }
  });
  // Promise.any resolves on the first gateway that returns a valid directory.
  return Promise.any(attempts);
}

/**
 * Load the directory from Bulletin, falling back to the baked snapshot on any
 * failure. Always resolves — the page must render either way.
 */
export async function loadDirectory(): Promise<DirectoryResult> {
  try {
    const map = await fetchJsonRace(DIRECTORY_CID);
    return {
      apps: buildApps(map),
      source: 'bulletin',
      cid: DIRECTORY_CID,
      excluded: excludedFrom(map),
    };
  } catch {
    // Fall through to the baked copy — imported lazily so a fetch success never
    // pays for parsing it.
    const { default: baked } = await import('./discovered.json');
    const map = baked as unknown as Record<string, Discovered>;
    return {
      apps: buildApps(map),
      source: 'baked',
      cid: null,
      excluded: excludedFrom(map),
    };
  }
}
