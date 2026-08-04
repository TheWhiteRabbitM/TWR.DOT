import type { AppEntry, Activity, ReadContract, Tier } from './types';
import type { MsgKey } from './i18n';
import discovered from './discovered.json';

/**
 * The .dot app directory.
 *
 * Two layers:
 *  - DISCOVERED: every .dot name found by the indexer walking Asset Hub blocks
 *    (indexer/index-apps.mjs). This is the real ecosystem, third-party apps
 *    included — the registry can't be enumerated by a contract call, so the
 *    names come from registration calldata.
 *  - Readers below: four apps whose ABI dotmetrics hard-codes. Their figures are
 *    presented as OUR reading of a contract, never as a rank — see READERS.
 *
 * Ranking uses chain facts only, and the per-app number any name can obtain is
 * the event count for the address it declares in a `contract` record.
 */

function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  return Number(value ?? 0);
}

/** Struct field access tolerant of array or named-object decoding. */
function field(v: unknown, i: number, name: string): unknown {
  if (Array.isArray(v)) return v[i];
  if (v && typeof v === 'object') return (v as Record<string, unknown>)[name];
  return undefined;
}

/**
 * One indexed .dot name. Every field except the first four is a CHAIN FACT
 * written by indexer/enrich-onchain.mjs — read off the registry and the content
 * resolver, never inferred, never scored.
 */
export interface Discovered {
  label: string;
  domain: string;
  url: string;
  firstSeenBlock: number;
  /** Unix seconds of the registration block, added by indexer/enrich-times.mjs. */
  firstSeenAt?: number;
  /**
   * `registry.owner(namehash(label + '.dot'))`, checksummed. Present on every
   * indexed entry — a name without an owner is not in the directory at all.
   * Optional only for the code-level fallbacks below, which predate the index.
   */
  owner?: string;
  /** From the `manifest` text record. */
  displayName?: string;
  description?: string;
  iconCid?: string;
  /** `baf…` from the contenthash record: the deployed bundle. */
  contenthash?: string;
  /** An `executable` record exists on `app.<label>.dot`. */
  hasExecutable?: boolean;
  /**
   * From the `contract` text record: the address this name declares as its own,
   * lowercased. dotmetrics' convention, open to anyone — see AppEntry.contract.
   */
  contract?: string;
  /**
   * What the indexer wrote at the time this file was published. NOT what the
   * page renders: {@link buildApps} recomputes the tier from the records above,
   * so a directory published under the older four-tier numbering still shows
   * correctly. Typed loosely for exactly that reason — old files hold a 3.
   */
  tier?: number;
  /**
   * From indexer/probe-liveness.mjs: did our gateway serve the contenthash
   * bundle at the last probe? Absent on names with nothing to probe and on
   * directory copies that predate the probe — see {@link AppEntry.alive}.
   */
  alive?: boolean;
  /** Unix seconds of the last probe that found the bundle reachable. */
  lastSeenAliveAt?: number;
  /** Day-coarse unix seconds of the last probe. Not rendered; kept for state. */
  livenessCheckedAt?: number;
}

/** The directory baked into the bundle at build time — the always-available fallback. */
const DISCOVERED = discovered as unknown as Record<string, Discovered>;

/**
 * Presentation for the four apps dotmetrics hand-codes a contract reader for.
 * Every other name is described by its own on-chain manifest, or not at all.
 *
 * A tagline is a FALLBACK for a name that publishes no description of its own.
 * It is not a rank and it no longer buys any position in the index: these four
 * are sorted, badged and counted by exactly the same chain facts as everybody
 * else.
 */
const KNOWN: Record<string, { name: string; tagline: MsgKey }> = {
  openpetition: {
    name: 'OpenPetition',
    tagline: 'app.tagline.openpetition',
  },
  thebutton: {
    name: 'The Button',
    tagline: 'app.tagline.thebutton',
  },
  truereviews: {
    name: 'TrueReviews',
    tagline: 'app.tagline.truereviews',
  },
  discreetly: {
    name: 'Discreet',
    tagline: 'app.tagline.discreetly',
  },
};

/**
 * Contract readers dotmetrics hard-codes, keyed by label.
 *
 * These are real numbers off real contracts, and they stay. What they no longer
 * do is RANK anything. Hand-coding an ABI is work only the index's operator can
 * do, so anything derived from it is a property of dotmetrics, not of the app —
 * and a directory that puts its own author's apps on top is not a directory.
 * The figures below are rendered as our reading, under our name, in a secondary
 * line; the ranking is decided entirely by {@link Discovered.tier}.
 */
const READERS: Record<string, AppEntry['read']> = {
  async openpetition(readContract: ReadContract) {
    const c = readContract('0x9e195eeca2E3BAB0ffC236f51Fd6c4a0330C38E1', [
      'function count() view returns (uint256)',
      'function page(uint256 offset, uint256 limit) view returns (tuple(bytes32 author, uint64 createdAt, uint32 fullCount, uint32 liteCount, string title, string bodyCid)[] slice)',
    ]);
    const total = num(await c.count());
    const rows = (await c.page(0n, 500n).catch(() => [])) as unknown[];

    let verified = 0;
    let unverified = 0;
    const activity: Activity[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      verified += num(field(r, 2, 'fullCount'));
      unverified += num(field(r, 3, 'liteCount'));
      const title = String(field(r, 4, 'title') ?? '');
      if (title) {
        activity.push({ app: 'OpenPetition', text: title, at: num(field(r, 1, 'createdAt')) || undefined });
      }
    }
    activity.reverse();

    return {
      headline: { label: 'metric.petitions', value: total },
      metrics: [
        { label: 'metric.verifiedSignatures', value: verified },
        { label: 'metric.unverified', value: unverified },
      ],
      activity: activity.slice(0, 5),
    };
  },

  async truereviews(readContract: ReadContract) {
    const c = readContract('0x29aF38913652B32989D1d96C51Af641980E55698', [
      'function placeCount() view returns (uint256)',
    ]);
    const places = num(await c.placeCount());
    return {
      headline: { label: 'metric.placesReviewed', value: places },
      metrics: [],
      activity: [],
    };
  },

  async discreetly(readContract: ReadContract) {
    const c = readContract('0x8Fa1fcA9f6E8C333625c3caf064E94640175f375', [
      'function serviceCount() view returns (uint256)',
      'function bookingCount() view returns (uint256)',
    ]);
    const [servicesN, bookingsN] = await Promise.all([c.serviceCount(), c.bookingCount()]);
    return {
      headline: { label: 'metric.servicesListed', value: num(servicesN) },
      metrics: [{ label: 'metric.bookings', value: num(bookingsN) }],
      activity: [],
    };
  },

  async thebutton(readContract: ReadContract) {
    const c = readContract('0xC16Ee1AaF736DCF624f0A183f0975E3F05991DDb', [
      'function totalPresses() view returns (uint256)',
      'function rollLength() view returns (uint256)',
    ]);
    const presses = num(await c.totalPresses());
    const roll = num(await c.rollLength().catch(() => presses));
    return {
      headline: { label: 'metric.presses', value: presses },
      metrics: [{ label: 'metric.humansRegistered', value: roll }],
      activity: [],
    };
  },
};

/**
 * Apps we know exist but whose registration predates the indexed range. The
 * indexer fills these in as its window extends backwards; until then they must
 * still appear, otherwise a live app silently vanishes from the directory.
 */
const ALWAYS: Discovered[] = [
  {
    label: 'thebutton',
    domain: 'thebutton.dot',
    url: 'https://thebutton.dev-dot.li',
    firstSeenBlock: 0,
  },
  // Registered recently — listed here until the scheduled indexer run catches
  // them, so their live contract metrics show up immediately.
  {
    label: 'truereviews',
    domain: 'truereviews.dot',
    url: 'https://truereviews.dev-dot.li',
    firstSeenBlock: 11376975,
  },
  {
    label: 'discreetly',
    domain: 'discreetly.dot',
    url: 'https://discreetly.dev-dot.li',
    // Approximate registration block so newest-first ordering holds; the
    // indexer's next pass overwrites this with the exact value.
    firstSeenBlock: 11413600,
  },
];

/**
 * The tier, computed here from the entry's own records rather than read out of
 * its `tier` field.
 *
 * The directory is fetched at runtime from a Bulletin CID, and CIDs are
 * immutable: every directory ever published is still out there, numbered by
 * whatever scheme was current when it was written. This renumbering (0 live
 * data / 1 published / 2 deployed / 3 name only → 0 published / 1 deployed /
 * 2 name only) would otherwise make an old file render one tier off across the
 * board, and its old tier 3 would index past the end of the label table.
 *
 * Deriving it costs nothing — the inputs are the same records the indexer used —
 * and it means the numbering can never drift between the file and the UI again.
 * The indexer still writes `tier`, for its own run summary and for anything else
 * reading apps.json; this is simply not the copy the page trusts.
 */
function tierOf(d: Discovered): Tier {
  if (d.displayName || d.description) return 0; // published: a readable manifest
  if (d.contenthash) return 1; // deployed: a bundle, nothing describing it
  return 2; // name only
}

/** An entry in the directory file, as opposed to the `excluded` list beside them. */
function isEntry(value: unknown): value is Discovered {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Discovered).label === 'string'
  );
}

/**
 * The labels the indexer found but the registry disowned: ascii runs that were
 * never names. Kept so the dashboard can say how many candidates it threw away
 * instead of quietly inflating the ecosystem by a third.
 */
export function excludedFrom(map: Record<string, unknown>): string[] {
  const list = (map as { excluded?: unknown }).excluded;
  return Array.isArray(list) ? list.filter((l): l is string => typeof l === 'string') : [];
}

/**
 * Turn a discovered-app map (from Bulletin or from the baked snapshot) into the
 * presented directory: newest registration first, readers and presentation
 * attached. Pure — the same input always yields the same list.
 */
export function buildApps(map: Record<string, Discovered>): AppEntry[] {
  const entries = Object.values(map).filter(isEntry);
  const all: Discovered[] = [
    ...entries,
    ...ALWAYS.filter((a) => !isEntry(map[a.label])),
  ];
  return all
    .sort((a, b) => b.firstSeenBlock - a.firstSeenBlock)
    .map((d) => {
      const known = KNOWN[d.label];
      const read = READERS[d.label] ?? null;
      return {
        id: d.label,
        name: known?.name ?? d.displayName ?? d.label,
        domain: d.domain,
        tagline: known?.tagline ?? 'app.tagline.generic',
        contract: d.contract ?? '',
        url: d.url,
        firstSeenBlock: d.firstSeenBlock,
        firstSeenAt: d.firstSeenAt,
        owner: d.owner ?? '',
        displayName: d.displayName,
        description: d.description,
        iconCid: d.iconCid,
        contenthash: d.contenthash,
        hasExecutable: d.hasExecutable ?? false,
        alive: d.alive,
        lastSeenAliveAt: d.lastSeenAliveAt,
        // Chain facts, and nothing else. An entry with no records is name-only
        // until one proves otherwise. Note what does NOT appear in tierOf():
        // `read`. Holding a hand-coded reader for an app used to promote it to
        // the top tier, which made the highest rank in a public directory
        // reachable only by the person running the index.
        tier: tierOf(d),
        read,
      };
    });
}

/** The baked directory — rendered instantly, then replaced by the Bulletin copy. */
export const APPS: AppEntry[] = buildApps(DISCOVERED);

/** Labels the ascii scan proposed and `registry.owner()` rejected. */
export const EXCLUDED: string[] = excludedFrom(DISCOVERED as Record<string, unknown>);

/** How fresh the baked directory is. */
export const DIRECTORY_SIZE = APPS.length;
