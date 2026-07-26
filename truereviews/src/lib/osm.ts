import type { Place } from './types';
import { categoryEmoji } from './format';

/**
 * Business search via OpenStreetMap's Nominatim — free, no API key, open data.
 * Each result carries a stable OSM reference ("node/240109189") that becomes the
 * place's on-chain anchor, so everyone reviews the same real place.
 *
 * Usage policy: ≤ 1 request/second and a real referer (the browser sets it). The
 * UI debounces typing so we never hammer it. If the host blocks outbound calls,
 * search simply returns nothing and the rest of the app is unaffected.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

interface NominatimHit {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

/**
 * A real photo for a business, when OSM knows one: the `image` tag is a direct
 * URL; `wikimedia_commons` is a `File:...` name served via Special:FilePath
 * (CORS-open on upload.wikimedia.org). Best-effort — most places have neither.
 */
function photoOf(h: NominatimHit): string | undefined {
  const t = h.extratags ?? {};
  if (t.image && /^https?:\/\//.test(t.image)) return t.image;
  const wm = t.wikimedia_commons;
  if (wm && wm.startsWith('File:')) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wm.slice(5))}?width=640`;
  }
  return undefined;
}

function prettyCategory(h: NominatimHit): string {
  const t = (h.type ?? '').replace(/_/g, ' ');
  const c = (h.category ?? '').replace(/_/g, ' ');
  if (t && t !== 'yes') return t.replace(/\b\w/g, (m) => m.toUpperCase());
  if (c) return c.replace(/\b\w/g, (m) => m.toUpperCase());
  return 'Place';
}

function shortAddress(h: NominatimHit): string {
  const a = h.address ?? {};
  const town = a.city || a.town || a.village || a.municipality || a.suburb || '';
  const road = a.road || '';
  return [road, town].filter(Boolean).join(', ') || (h.display_name ?? '').split(',').slice(1, 3).join(',').trim();
}

function toPlace(h: NominatimHit): Place | null {
  if (!h.osm_type || !h.osm_id) return null;
  const osmRef = `${h.osm_type}/${h.osm_id}`;
  const name = h.name || (h.display_name ?? '').split(',')[0] || 'Unnamed place';
  const category = prettyCategory(h);
  return {
    key: osmRef,
    osmRef,
    name,
    category,
    address: shortAddress(h),
    lat: Number(h.lat ?? 0),
    lon: Number(h.lon ?? 0),
    emoji: categoryEmoji(`${category} ${h.type ?? ''}`),
    image: photoOf(h),
    avgFull: 0,
    fullCount: 0,
    liteCount: 0,
  };
}

export async function searchOsm(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&extratags=1&limit=12&namedetails=0`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const h of hits) {
    const p = toPlace(h);
    if (p && p.name !== 'Unnamed place' && !seen.has(p.osmRef)) {
      seen.add(p.osmRef);
      out.push(p);
    }
  }
  return out;
}

/** Deep links back to the real business on the big maps. */
export function osmLink(p: Place): string {
  const [type, id] = p.osmRef.split('/');
  return `https://www.openstreetmap.org/${type}/${id}`;
}

export function mapsLink(p: Place): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
}
