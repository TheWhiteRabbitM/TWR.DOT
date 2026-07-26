import type { Place, PlaceDetail, Review, ReviewsDriver } from './types';
import { categoryEmoji } from './format';
import { searchOsm } from './osm';
import seedBaked from './seed.json';

/**
 * Demo data layer. Personhood is granted to only a few accounts on this devnet,
 * so — like OpenPetition — the app runs in demo mode outside the host: real
 * OpenStreetMap search, seeded places with reviews, and you can post freely.
 *
 * The seed itself is Bulletin content: the same JSON baked here is published as
 * a CID and fetched at runtime, so refreshing the demo dataset is "upload a new
 * seed, bump the CID" — the pattern every app in this workspace uses for data.
 */
const KEY = 'truereviews:demo:v2';
const YOU = 'demo-you-alias';

/** Bulletin CID of the seed dataset (see scratchpad/upload-seed.sh). */
export const SEED_CID = 'bafybeigaxbuhre6u3b773lbrkeuiltbqvnn3xgihxw53bis4qqgjm2ggbm';

const GATEWAYS = [
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
];

interface SeedReview {
  alias: string;
  rating: number;
  tier: number;
  daysAgo: number;
  body: string;
}

interface SeedPlace {
  key: string;
  osmRef: string;
  name: string;
  category: string;
  address: string;
  lat: number;
  lon: number;
  image?: string;
  reviews: SeedReview[];
}

interface Seed {
  version: number;
  places: SeedPlace[];
}

interface MockState {
  places: Record<string, Place>;
  reviews: Record<string, Review[]>;
  seedVersion: number;
}

function fromSeed(seed: Seed): MockState {
  const now = Math.floor(Date.now() / 1000);
  const places: Record<string, Place> = {};
  const reviews: Record<string, Review[]> = {};
  for (const p of seed.places) {
    places[p.key] = {
      key: p.key,
      osmRef: p.osmRef,
      name: p.name,
      category: p.category,
      address: p.address,
      lat: p.lat,
      lon: p.lon,
      emoji: categoryEmoji(p.category),
      image: p.image,
      avgFull: 0,
      fullCount: 0,
      liteCount: 0,
    };
    reviews[p.key] = p.reviews.map((r) => ({
      alias: r.alias,
      rating: r.rating,
      tier: r.tier,
      at: now - r.daysAgo * 86_400,
      body: r.body,
    }));
  }
  return { places, reviews, seedVersion: seed.version };
}

function read(): MockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* ignore */
  }
  const seeded = fromSeed(seedBaked as Seed);
  write(seeded);
  return seeded;
}

function write(state: MockState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

/**
 * Fetch the seed from Bulletin and merge any places we don't have yet — your
 * own reviews are never touched. Fire-and-forget on startup.
 */
async function refreshSeedFromBulletin(): Promise<boolean> {
  const attempts = GATEWAYS.map(async (toUrl) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(toUrl(SEED_CID), { signal: ctrl.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Seed;
      if (!Array.isArray(json.places)) throw new Error('bad seed');
      return json;
    } finally {
      clearTimeout(t);
    }
  });
  try {
    const seed = await Promise.any(attempts);
    const fresh = fromSeed(seed);
    const state = read();
    let changed = false;
    for (const [k, p] of Object.entries(fresh.places)) {
      if (!state.places[k]) {
        state.places[k] = p;
        state.reviews[k] = fresh.reviews[k] ?? [];
        changed = true;
      }
    }
    if (changed || state.seedVersion !== fresh.seedVersion) {
      state.seedVersion = fresh.seedVersion;
      write(state);
    }
    return changed;
  } catch {
    return false;
  }
}

function detailOf(place: Place, reviews: Review[]): PlaceDetail {
  let sumFull = 0;
  let fullCount = 0;
  let liteCount = 0;
  let yourRating = 0;
  const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of reviews) {
    histogram[r.rating - 1] += 1;
    if (r.tier >= 2) {
      sumFull += r.rating;
      fullCount += 1;
    } else {
      liteCount += 1;
    }
    if (r.alias === YOU) yourRating = r.rating;
  }
  const sorted = [...reviews].sort((a, b) => b.at - a.at);
  return {
    place: { ...place, avgFull: fullCount ? sumFull / fullCount : 0, fullCount, liteCount },
    reviews: sorted,
    yourRating,
    histogram,
  };
}

export function createMockDriver(): ReviewsDriver {
  // Pull fresh seed content from Bulletin in the background on startup.
  void refreshSeedFromBulletin();

  return {
    demo: true,
    tier: () => 2,

    async recent() {
      const s = read();
      return Object.keys(s.places)
        .map((k) => detailOf(s.places[k], s.reviews[k] ?? []).place)
        .sort((a, b) => b.fullCount + b.liteCount - (a.fullCount + a.liteCount));
    },

    async detail(key) {
      const s = read();
      const place = s.places[key];
      if (!place) {
        return {
          place: { key, osmRef: key, name: 'Place', category: 'Place', address: '', lat: 0, lon: 0, emoji: '📍', avgFull: 0, fullCount: 0, liteCount: 0 },
          reviews: [],
          yourRating: 0,
          histogram: [0, 0, 0, 0, 0],
        };
      }
      return detailOf(place, s.reviews[key] ?? []);
    },

    async search(query) {
      try {
        const found = await searchOsm(query);
        if (found.length) {
          const s = read();
          return found.map((p) => (s.places[p.key] ? detailOf(s.places[p.key], s.reviews[p.key] ?? []).place : p));
        }
      } catch {
        /* fall through to local */
      }
      const s = read();
      const q = query.trim().toLowerCase();
      return Object.keys(s.places)
        .map((k) => detailOf(s.places[k], s.reviews[k] ?? []).place)
        .filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    },

    async review(place, rating, body) {
      const s = read();
      if (!s.places[place.key]) s.places[place.key] = place;
      const list = s.reviews[place.key] ?? [];
      const existing = list.findIndex((r) => r.alias === YOU);
      const entry: Review = { alias: YOU, rating, tier: 2, at: Math.floor(Date.now() / 1000), body };
      if (existing >= 0) list[existing] = entry;
      else list.unshift(entry);
      s.reviews[place.key] = list;
      write(s);
      return detailOf(s.places[place.key], list);
    },

    async mine() {
      const s = read();
      const out: { place: Place; review: Review }[] = [];
      for (const [k, list] of Object.entries(s.reviews)) {
        const r = list.find((x) => x.alias === YOU);
        if (r && s.places[k]) out.push({ place: detailOf(s.places[k], list).place, review: r });
      }
      return out.sort((a, b) => b.review.at - a.review.at);
    },
  };
}

export function resetDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
