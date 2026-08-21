import { buildApps, excludedFrom, type Discovered } from './registry';
import { textOf } from './dotns';
import type { AppEntry } from './types';

/**
 * The .dot app directory, served from Bulletin instead of baked into the JS
 * bundle.
 *
 * Why: the directory grows every time someone registers a .dot name. Baked into
 * the bundle, refreshing it meant re-running the indexer AND rebuilding AND
 * republishing the whole site. As a Bulletin object it is content-addressed data
 * the page fetches at runtime — byte's rule, "keep heavy data off the bundle,
 * on bulletin; it's just a hoster."
 *
 * WHERE THE LATEST CID COMES FROM, in order of preference:
 *
 *   1. The `directory` text record on dotmetrics.dot, read at load time off the
 *      content resolver over the same public RPC as everything else. The record
 *      is the mutable pointer: the indexer moves it when the directory actually
 *      changes, and no rebuild or republish of this site is involved at all.
 *   2. The CID pinned below at build time — the newest directory the build knew
 *      about, for when the record read fails or times out.
 *   3. The snapshot baked into the bundle, which needs no network at all.
 *
 * First paint NEVER waits on any of this: the page renders the baked snapshot
 * synchronously and upgrades when a fetch lands. The footer states which of the
 * three sources actually won, because "live", "pinned" and "baked" are three
 * different claims about freshness and the reader is owed the real one.
 */
export const DIRECTORY_CID = 'bafybeia5m3j6t5a5pbp6jdakkpfl4nfw7iwvpt6g5fcey5ixflwt5geaim';

/** The name and key the mutable pointer lives under. */
const RECORD_NAME = 'dotmetrics.dot';
const RECORD_KEY = 'directory';

/**
 * The record read is one eth_call and must not delay the directory fetch for
 * long when the RPC is slow: past this budget the pinned CID proceeds alone.
 */
const RECORD_TIMEOUT_MS = 3_500;

/** A plausible CIDv1 in text form — what the record must hold to be followed. */
const CID_RE = /^baf[a-z0-9]{50,}$/;

/**
 * Public IPFS gateways that bridge the devnet Bulletin bitswap network. Raced,
 * not tried in series: gateway latency is wildly uneven and a slow one must not
 * hold up a fast one. First valid answer wins; if none answer we fall back to
 * the baked snapshot.
 *
 * The devnet gateway leads the list because it is the one that actually holds
 * our CIDs — the public bridges resolve them only occasionally (verified).
 */
const GATEWAYS = [
  (cid: string) => `https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/${cid}`,
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
  (cid: string) => `https://${cid}.ipfs.cf-ipfs.com/`,
];

/** A URL for `cid` on the gateway most likely to actually serve it. */
export const gatewayUrl = (cid: string): string => GATEWAYS[0](cid);

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Where the rendered directory came from — three different freshness claims:
 *   'record' — the CID the `directory` text record points at right now
 *   'pinned' — the CID pinned into this build, fetched from Bulletin
 *   'baked'  — the snapshot compiled into the bundle; nothing was fetched
 */
export type DirectorySource = 'record' | 'pinned' | 'baked';

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
  /**
   * When THIS directory was generated, carried inside the directory itself.
   *
   * The page used to date itself from `ecosystem.json`, which is imported
   * statically and therefore frozen at the last SITE publish. Since the site
   * only republishes when its source changes — correctly, to spare
   * transactions — the counts on screen were live while the timestamp beside
   * them aged: 79 apps, "updated 11h ago", both true of different things.
   *
   * A timestamp that travels with the data cannot drift away from it. Null when
   * an older directory is being served that predates the field.
   */
  generatedAt: number | null;
}

/**
 * The directory's own generation time, if it carries one.
 *
 * Excluded from the upload digest by construction — directory-digest.mjs hashes
 * per-name semantic fields and no timestamps — so adding this cannot make an
 * unchanged directory look changed and cost a transaction every hour.
 */
function generatedFrom(map: Record<string, unknown>): number | null {
  const v = (map as { generatedAt?: unknown }).generatedAt;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
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
 * METADATA sits beside the entries — `excluded` as a list of rejected labels,
 * `generatedAt` as the directory's own timestamp — so those keys are skipped
 * rather than validated as apps.
 *
 * Enumerated rather than inferred: "skip anything that is not an object" would
 * also skip a malformed entry, and this check exists precisely to catch those.
 * Adding a metadata key without adding it here rejects the whole directory and
 * silently serves the baked copy instead, which is a failure with no symptom.
 */
const META_KEYS = new Set(['excluded', 'generatedAt']);

function isDiscoveredMap(value: unknown): value is Record<string, Discovered> {
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) => !META_KEYS.has(key),
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
 * The CID the `directory` record points at, or '' when the record is empty,
 * implausible, unreadable or slow. All four collapse to the same fallback — the
 * pinned CID — so they are not distinguished here; the footer's source line is
 * where the difference between record and pin is disclosed.
 */
async function readDirectoryRecord(): Promise<string> {
  try {
    const value = await Promise.race([
      // The catch is INSIDE the race: if the timeout wins first, a later
      // rejection of the losing call must not surface as an unhandled error.
      textOf(RECORD_NAME, RECORD_KEY).catch(() => ''),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve(''), RECORD_TIMEOUT_MS);
      }),
    ]);
    const cid = value.trim();
    return CID_RE.test(cid) ? cid : '';
  } catch {
    return '';
  }
}

/**
 * Load the directory: the record's CID first, then the pinned CID, then the
 * baked snapshot. Always resolves — the page must render either way.
 */
export async function loadDirectory(): Promise<DirectoryResult> {
  const recordCid = await readDirectoryRecord();

  if (recordCid) {
    try {
      const map = await fetchJsonRace(recordCid);
      return {
        apps: buildApps(map),
        source: 'record',
        cid: recordCid,
        excluded: excludedFrom(map),
        generatedAt: generatedFrom(map),
      };
    } catch {
      // The record named a CID no gateway would serve. Fall through to the
      // pinned CID rather than to nothing — an unreachable pointer must not
      // cost the reader the last directory this build verified.
    }
  }

  if (recordCid !== DIRECTORY_CID) {
    try {
      const map = await fetchJsonRace(DIRECTORY_CID);
      return {
        apps: buildApps(map),
        source: 'pinned',
        cid: DIRECTORY_CID,
        excluded: excludedFrom(map),
        generatedAt: generatedFrom(map),
      };
    } catch {
      // Fall through to the baked copy.
    }
  }

  // Imported lazily so a fetch success never pays for parsing it.
  const { default: baked } = await import('./discovered.json');
  const map = baked as unknown as Record<string, Discovered>;
  return {
    apps: buildApps(map),
    source: 'baked',
    cid: null,
    excluded: excludedFrom(map),
        generatedAt: generatedFrom(map),
  };
}
