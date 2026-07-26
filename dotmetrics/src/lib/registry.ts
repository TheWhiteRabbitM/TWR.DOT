import type { AppEntry, Activity, ReadContract } from './types';
import discovered from './discovered.json';

/**
 * The .dot app directory.
 *
 * Two layers:
 *  - DISCOVERED: every .dot name found by the indexer walking Asset Hub blocks
 *    (indexer/index-apps.mjs). This is the real ecosystem, third-party apps
 *    included — the registry can't be enumerated by a contract call, so the
 *    names come from registration calldata.
 *  - Readers below: for apps whose contract we know, live on-chain metrics.
 *    Everything else is listed with its domain and link only.
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
  /** 0 live data · 1 published · 2 deployed · 3 name only. Never a score. */
  tier?: 0 | 1 | 2 | 3;
}

/** The directory baked into the bundle at build time — the always-available fallback. */
const DISCOVERED = discovered as unknown as Record<string, Discovered>;

/**
 * Presentation for the apps dotmetrics reads live contract metrics for. These
 * four are the only names the dashboard claims to know anything extra about;
 * every other name is described by its own on-chain manifest, or not at all.
 */
const KNOWN: Record<string, { name: string; tagline: string }> = {
  openpetition: {
    name: 'OpenPetition',
    tagline: 'Petitions signed by real people — one signature per person.',
  },
  thebutton: {
    name: 'The Button',
    tagline: 'One button, one press per human, ever.',
  },
  truereviews: {
    name: 'TrueReviews',
    tagline: 'One verified human, one review per place.',
  },
  discreetly: {
    name: 'Discreet',
    tagline: 'Private bookings for real people — anonymous, sybil-proof, escrowed.',
  },
};

/** Live readers, keyed by label. Only apps whose contract we know. */
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
      headline: { label: 'petitions', value: total },
      metrics: [
        { label: 'verified signatures', value: verified },
        { label: 'unverified', value: unverified },
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
      headline: { label: 'places reviewed', value: places },
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
      headline: { label: 'services listed', value: num(servicesN) },
      metrics: [{ label: 'bookings', value: num(bookingsN) }],
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
      headline: { label: 'presses', value: presses },
      metrics: [{ label: 'humans on the register', value: roll }],
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
        tagline: known?.tagline ?? d.description ?? 'Registered on the .dot network.',
        contract: '',
        url: d.url,
        firstSeenBlock: d.firstSeenBlock,
        firstSeenAt: d.firstSeenAt,
        owner: d.owner ?? '',
        displayName: d.displayName,
        description: d.description,
        iconCid: d.iconCid,
        contenthash: d.contenthash,
        hasExecutable: d.hasExecutable ?? false,
        // A reader is live data by definition; otherwise the tier the indexer
        // computed from chain facts stands, and an un-enriched entry is
        // name-only until proven otherwise.
        tier: read ? 0 : d.tier ?? 3,
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
