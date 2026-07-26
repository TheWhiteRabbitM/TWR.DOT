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

export interface Discovered {
  label: string;
  domain: string;
  url: string;
  firstSeenBlock: number;
  lastSeenBlock: number;
  /** Unix seconds of the registration block, added by indexer/enrich-times.mjs. */
  firstSeenAt?: number;
}

/** The directory baked into the bundle at build time — the always-available fallback. */
const DISCOVERED = discovered as Record<string, Discovered>;

/** Presentation for apps we know something about. */
const KNOWN: Record<string, { name: string; tagline: string; accent: string; glyph: string }> = {
  openpetition: {
    name: 'OpenPetition',
    tagline: 'Petitions signed by real people — one signature per person.',
    accent: '#e6007a',
    glyph: '✍',
  },
  thebutton: {
    name: 'The Button',
    tagline: 'One button, one press per human, ever.',
    accent: '#34a853',
    glyph: '⏻',
  },
  handshake: {
    name: 'Handshake',
    tagline: 'Agreements sealed by two verified humans.',
    accent: '#0e7c6b',
    glyph: '🤝',
  },
  dotmetrics: {
    name: 'dotmetrics',
    tagline: 'This dashboard.',
    accent: '#1a73e8',
    glyph: '📊',
  },
  truereviews: {
    name: 'TrueReviews',
    tagline: 'One verified human, one review per place.',
    accent: '#0a84ff',
    glyph: '⭐',
  },
  discreetly: {
    name: 'Discreet',
    tagline: 'Private bookings for real people — anonymous, sybil-proof, escrowed.',
    accent: '#0f766e',
    glyph: '🔒',
  },
  italiarovente: {
    name: 'Italia Rovente',
    tagline: "Italy's warming since 1940, city by city.",
    accent: '#d23a22',
    glyph: '🌡',
  },
  wudcommunity: {
    name: 'WUD Community',
    tagline: 'Unofficial $WUD holders dashboard.',
    accent: '#e6007a',
    glyph: '🐋',
  },
  btcusd: { name: 'BTC/USD', tagline: 'Price feed.', accent: '#f7931a', glyph: '₿' },
  ethusd: { name: 'ETH/USD', tagline: 'Price feed.', accent: '#627eea', glyph: 'Ξ' },
  dotusd: { name: 'DOT/USD', tagline: 'Price feed.', accent: '#e6007a', glyph: '●' },
};

const PALETTE = ['#1a73e8', '#34a853', '#e6007a', '#e37400', '#7b1fa2', '#00897b', '#c2185b', '#5d4037'];

function accentFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

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
    lastSeenBlock: 0,
  },
  // Registered recently — listed here until the scheduled indexer run catches
  // them, so their live contract metrics show up immediately.
  {
    label: 'truereviews',
    domain: 'truereviews.dot',
    url: 'https://truereviews.dev-dot.li',
    firstSeenBlock: 11376975,
    lastSeenBlock: 11376975,
  },
  {
    label: 'discreetly',
    domain: 'discreetly.dot',
    url: 'https://discreetly.dev-dot.li',
    // Approximate registration block so newest-first ordering holds; the
    // indexer's next pass overwrites this with the exact value.
    firstSeenBlock: 11413600,
    lastSeenBlock: 11413600,
  },
];

/**
 * Turn a discovered-app map (from Bulletin or from the baked snapshot) into the
 * presented directory: newest registration first, readers and presentation
 * attached. Pure — the same input always yields the same list.
 */
export function buildApps(map: Record<string, Discovered>): AppEntry[] {
  const all: Discovered[] = [
    ...Object.values(map),
    ...ALWAYS.filter((a) => !map[a.label]),
  ];
  return all
    .sort((a, b) => b.firstSeenBlock - a.firstSeenBlock)
    .map((d) => {
      const known = KNOWN[d.label];
      return {
        id: d.label,
        name: known?.name ?? d.label,
        domain: d.domain,
        tagline: known?.tagline ?? 'Registered on the .dot network.',
        contract: '',
        url: d.url,
        accent: known?.accent ?? accentFor(d.label),
        glyph: known?.glyph ?? d.label.slice(0, 1).toUpperCase(),
        firstSeenBlock: d.firstSeenBlock,
        firstSeenAt: d.firstSeenAt,
        read: READERS[d.label] ?? null,
      };
    });
}

/** The baked directory — rendered instantly, then replaced by the Bulletin copy. */
export const APPS: AppEntry[] = buildApps(DISCOVERED);

/** How fresh the baked directory is. */
export const DIRECTORY_SIZE = APPS.length;
