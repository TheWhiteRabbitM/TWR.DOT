/**
 * A real photo for a real business, from Wikimedia Commons, with no API key
 * and no server.
 *
 * How this works and why it is this shape:
 *   Commons is a landmark gazetteer, not a business directory. Searching by
 *   coordinates alone returns whatever a stranger happened to photograph
 *   nearby — a plate of carpaccio 26 m from a gelateria, a car workshop 56 m
 *   from a trattoria. Geotags are camera GPS, not an assertion about the
 *   subject. So proximity alone is never enough: a candidate is accepted only
 *   when its FILE TITLE names the business (a distinctive token of the name)
 *   *and* it sits within a few dozen metres.
 *
 *   The honest consequence: most ordinary places have no photo, and that is the
 *   normal case, not a failure. The card is designed for absence (a category
 *   glyph on a tinted panel) and a photo is a bonus on top.
 *
 * Two requests per place at most (geosearch, then imageinfo for the licence),
 * both cached in localStorage — a hit for a month, a miss for a week, and a
 * transient failure for only an hour so one rate-limited minute does not blank
 * a place for days.
 */
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

export interface PlacePhoto {
  url: string;
  /** Attribution line to render under the image; Commons requires credit. */
  credit: string;
  /** Commons file page, so the credit can link to the source. */
  source: string;
}

interface CacheEntry {
  /** `null` = looked up, genuinely nothing suitable. */
  photo: PlacePhoto | null;
  /** Epoch ms after which this entry is stale. */
  until: number;
}

const CACHE_KEY = 'tr.photo.v1';
const MAX_ENTRIES = 300;
const TTL_HIT = 30 * 24 * 3600_000;
const TTL_MISS = 7 * 24 * 3600_000;
const TTL_TRANSIENT = 3600_000;

/** Words that identify a *kind* of business, not a specific one. */
const GENERIC = new Set([
  'caffe', 'cafe', 'bar', 'ristorante', 'restaurant', 'trattoria', 'osteria',
  'pizzeria', 'gelateria', 'mercato', 'market', 'libreria', 'bookshop', 'museo',
  'museum', 'hotel', 'antica', 'antico', 'vecchia', 'vecchio', 'nuovo', 'nuova',
  'the', 'shop', 'store', 'pub', 'birreria', 'pasticceria', 'panificio',
]);

/** Categories where the OSM object IS an area, so a wider radius is honest. */
const AREA_LIKE = /market|marketplace|square|piazza|park|mall|bazaar/i;

/** Titles that are historical or artwork rather than a photo of the place now. */
const NOT_A_PHOTO =
  /painting|dipinto|gem[äa]lde|engraving|incisione|litografia|stampa|postcard|cartolina|mappa|\bmap\b|\bplan\b|drawing|disegno/i;

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function writeCache(all: Record<string, CacheEntry>): void {
  try {
    const keys = Object.keys(all);
    if (keys.length > MAX_ENTRIES) {
      const oldest = keys.sort((a, b) => all[a].until - all[b].until).slice(0, keys.length - MAX_ENTRIES);
      for (const k of oldest) delete all[k];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* a full quota must never break rendering */
  }
}

/** Fold accents and punctuation away so "Caffè Greco" matches "Caffe_Greco". */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The tokens of a business name that could identify it in a file title.
 * "Antico Caffè Greco" -> ["greco"]; "Bar Sport" -> [] (unverifiable, so we
 * will not even look — a generic name cannot be confirmed from a title).
 */
function distinctiveTokens(name: string): string[] {
  return normalise(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !GENERIC.has(t));
}

interface GeoHit {
  pageid: number;
  title: string;
  dist: number;
}

/** In-flight and rate limiting: Commons is a donation-funded API, be polite. */
let chain: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<PlacePhoto | null>>();

function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.then(
    () => new Promise((r) => setTimeout(r, 250)),
    () => new Promise((r) => setTimeout(r, 250)),
  );
  return run;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Files near the place, nearest first. `list=geosearch` is what returns `dist`. */
async function nearbyFiles(lat: number, lon: number, radius: number): Promise<GeoHit[]> {
  const url =
    `${COMMONS}?action=query&list=geosearch&gscoord=${lat}%7C${lon}` +
    `&gsradius=${radius}&gsnamespace=6&gslimit=100&format=json&origin=*`;
  const j = (await getJson(url)) as { query?: { geosearch?: GeoHit[] } };
  return j.query?.geosearch ?? [];
}

/** Resolve a Commons file title to a usable thumbnail plus its licence. */
async function fileDetails(title: string): Promise<PlacePhoto | null> {
  const url =
    `${COMMONS}?action=query&titles=${encodeURIComponent(title)}` +
    `&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=960&format=json&origin=*`;
  const j = (await getJson(url)) as {
    query?: {
      pages?: Record<
        string,
        {
          imageinfo?: {
            thumburl?: string;
            descriptionurl?: string;
            extmetadata?: Record<string, { value?: string }>;
          }[];
        }
      >;
    };
  };
  const page = Object.values(j.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return null;

  const meta = info.extmetadata ?? {};
  // Reject anything shot before digital photography of a *current* storefront
  // would exist: a 19th-century plate is not what "a photo of this place" means.
  const shot = meta.DateTimeOriginal?.value ?? '';
  const year = Number(/(\d{4})/.exec(shot)?.[1] ?? 0);
  if (year && year < 1990) return null;

  const strip = (html?: string) => (html ?? '').replace(/<[^>]*>/g, '').trim();
  const author = strip(meta.Artist?.value) || 'Wikimedia Commons';
  const licence = strip(meta.LicenseShortName?.value) || 'see source';
  return {
    url: info.thumburl,
    credit: `${author} · ${licence}`,
    source: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

export interface PhotoSubject {
  osmRef: string;
  name: string;
  lat: number;
  lon: number;
  category?: string;
}

/**
 * Best available photo of this business, or `null` when there honestly isn't
 * one. Never throws, never blocks rendering.
 */
export async function findPhoto(subject: PhotoSubject): Promise<PlacePhoto | null> {
  const key = subject.osmRef;
  const cache = readCache();
  const hit = cache[key];
  if (hit && hit.until > Date.now()) return hit.photo;

  const running = inFlight.get(key);
  if (running) return running;

  const job = queued(async () => {
    let ttl = TTL_MISS;
    let found: PlacePhoto | null = null;
    try {
      const tokens = distinctiveTokens(subject.name);
      // A generic name ("Bar Sport") can never be confirmed from a file title,
      // so spending two requests on it would only invite a wrong photo.
      if (tokens.length) {
        const area = AREA_LIKE.test(subject.category ?? '');
        const files = await nearbyFiles(subject.lat, subject.lon, 300);
        const limit = area ? 300 : 150;
        const candidate = files
          .filter((f) => f.dist <= limit)
          .filter((f) => /\.jpe?g$/i.test(f.title))
          .filter((f) => !NOT_A_PHOTO.test(f.title))
          .filter((f) => !/(1[6-9]\d{2}|19[0-8]\d)/.test(f.title))
          .find((f) => {
            const t = normalise(f.title);
            return tokens.some((tok) => t.includes(tok));
          });
        if (candidate) {
          found = await fileDetails(candidate.title);
          if (found) ttl = TTL_HIT;
        }
      }
    } catch {
      // Network or rate limit: forget quickly so a blip is not a week-long gap.
      ttl = TTL_TRANSIENT;
    }
    const all = readCache();
    all[key] = { photo: found, until: Date.now() + ttl };
    writeCache(all);
    return found;
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}
