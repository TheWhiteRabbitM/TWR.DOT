import type { Lang, MsgKey, Vars } from './i18n';

/**
 * Machine translation of THIRD-PARTY text, on explicit request only.
 *
 * The descriptions this touches belong to the app authors who published them.
 * The rules that follow from that, and that the UI enforces:
 *
 *   · the original is what renders by default, on every load, forever;
 *   · nothing is translated until someone taps "translate";
 *   · a translation is labelled as machine output, never presented as the
 *     author's words, and is one tap away from being dismissed;
 *   · a failure is shown, never swallowed — see {@link TranslateError}.
 *
 * ENDPOINT CHOICE. This was probed, not assumed. From a sandboxed static page
 * with no API key, sending a browser `Origin`:
 *
 *   api.mymemory.translated.net  200, `Access-Control-Allow-Origin: *`, and a
 *                                plain GET, so no preflight is involved at all.
 *                                8/8 identical answers in a row; correct output
 *                                for fr/zh/ru→en and en/fr→it.  ← wired
 *   libretranslate.com           400 "Visit … to get an API key".
 *   libretranslate.de            301 to a landing page; the API is gone.
 *   translate.fedilab.app        200 with CORS, but 429 after ~8 calls and on
 *                                every concurrent burst. A courtesy instance
 *                                for one Android app, not a public API.
 *   translate.argosopentech.com, libretranslate.eownerdead.dedyn.io,
 *   translate.flossboxin.org.in, lt.blitzw.in    DNS no longer resolves.
 *   translate.terraprint.co, lt.vern.cc          502 from the front proxy.
 *   trans.zillyhuhn.com                          TLS certificate name mismatch.
 *
 * If a future probe finds MyMemory unusable, set {@link ENDPOINT} to `null`:
 * the marker and the detection stay, the translate affordance disappears
 * everywhere, and nothing else in the UI has to change.
 */

/* --------------------------------------------------------------- errors */

/**
 * A failure with a translated, human-readable reason attached.
 *
 * The reason travels as an i18n key plus its variables rather than as a
 * finished string, because the thing that fails (this module) has no business
 * knowing which language the reader is in — and the reader may switch languages
 * while the error is on screen.
 */
export class TranslateError extends Error {
  readonly key: MsgKey;
  readonly vars: Vars;
  constructor(key: MsgKey, vars: Vars = {}) {
    super(key);
    this.name = 'TranslateError';
    this.key = key;
    this.vars = vars;
  }
}

/* ------------------------------------------------------------- endpoint */

interface Endpoint {
  /** Host to declare to the sandbox — see lib/host-permissions.ts. */
  readonly host: string;
  /** Shown to the reader beside every translation. Attribution, not branding. */
  readonly label: string;
  /** Longest text the service accepts, in characters. */
  readonly maxChars: number;
  translate(text: string, from: string, to: Lang, signal: AbortSignal): Promise<string>;
}

/** MyMemory wants ISO-639-1, but is measurably better on Chinese with a region. */
function toServiceCode(code: string): string {
  return code === 'zh' ? 'zh-CN' : code;
}

const MYMEMORY: Endpoint = {
  host: 'api.mymemory.translated.net',
  label: 'MyMemory',
  maxChars: 500,

  async translate(text, from, to, signal) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text);
    url.searchParams.set('langpair', `${toServiceCode(from)}|${to}`);

    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (signal.aborted) throw new TranslateError('tr.err.timeout');
      throw new TranslateError(err instanceof Error && !navigator.onLine ? 'tr.err.offline' : 'tr.err.network');
    }
    if (!res.ok) throw new TranslateError('tr.err.http', { status: res.status });

    // Observed in probing: this endpoint occasionally answers 200 with a
    // zero-length body. Parsing that would throw a SyntaxError nobody could
    // read, so it gets its own message.
    const body = await res.text();
    if (!body.trim()) throw new TranslateError('tr.err.empty');

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new TranslateError('tr.err.badJson');
    }

    const data = json as {
      responseData?: { translatedText?: unknown };
      responseStatus?: unknown;
      responseDetails?: unknown;
      quotaFinished?: unknown;
    };

    // `responseStatus` comes back as the NUMBER 200 on success and as the
    // STRING "403" on every error, so it has to be coerced before comparison.
    const status = Number(data.responseStatus);
    const detail = typeof data.responseDetails === 'string' ? data.responseDetails.trim() : '';

    if (data.quotaFinished === true) throw new TranslateError('tr.err.quota');
    if (Number.isFinite(status) && status !== 200) {
      if (/QUOTA|ALL AVAILABLE FREE TRANSLATIONS/i.test(detail)) {
        throw new TranslateError('tr.err.quota');
      }
      // The service's own words, verbatim. It knows why it refused; guessing on
      // its behalf would only hide the reason.
      throw new TranslateError('tr.err.service', { detail: detail || `HTTP ${status}` });
    }

    const out = data.responseData?.translatedText;
    if (typeof out !== 'string' || !out.trim()) throw new TranslateError('tr.err.empty');
    return out;
  },
};

/**
 * The endpoint in use, or `null` to ship with no translation at all.
 *
 * Every translate affordance in the UI is gated on this being non-null, so
 * setting it to `null` is a complete, one-line withdrawal of the feature.
 */
export const ENDPOINT: Endpoint | null = MYMEMORY;

/** Attribution string for the "machine translation" banner. */
export const SERVICE_LABEL = ENDPOINT?.label ?? '';

/* ---------------------------------------------------------------- cache */

/**
 * Translations are cached in localStorage, keyed by source text and language
 * pair, so re-opening a row does not re-spend the shared daily quota.
 *
 * The cache holds RESULTS only. It deliberately does not remember that a reader
 * once translated a given description: the original has to be what renders on
 * the next load, and a "was showing the translation" flag would quietly undo
 * that.
 */
const CACHE_KEY = 'dotmetrics.mt';
const CACHE_MAX = 200;

type Cache = Record<string, string>;

function cacheKey(text: string, from: string, to: Lang): string {
  return `${from}>${to}:${text}`;
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    const keys = Object.keys(cache);
    // Oldest-first eviction: insertion order is preserved by JSON round-trips,
    // which is enough bookkeeping for a few hundred short strings.
    const trimmed =
      keys.length <= CACHE_MAX
        ? cache
        : Object.fromEntries(keys.slice(keys.length - CACHE_MAX).map((k) => [k, cache[k]]));
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // A full or refused quota must not turn a successful translation into an
    // error the reader sees.
  }
}

/** A cached translation, if one is already on this device. */
export function cachedTranslation(text: string, from: string, to: Lang): string | null {
  if (!ENDPOINT) return null;
  return readCache()[cacheKey(text, from, to)] ?? null;
}

/* ------------------------------------------------------------------ api */

const TIMEOUT_MS = 12_000;

/**
 * Translate `text` from `from` into `to`.
 *
 * Throws {@link TranslateError} on every failure path — there is no silent
 * fallback to the original, because a reader who tapped "translate" and got the
 * original back would have no way to tell that anything went wrong.
 */
export async function translate(text: string, from: string, to: Lang): Promise<string> {
  if (!ENDPOINT) throw new TranslateError('tr.err.network');

  const source = text.trim();
  const hit = cachedTranslation(source, from, to);
  if (hit) return hit;

  if (source.length > ENDPOINT.maxChars) {
    throw new TranslateError('tr.err.tooLong', { n: source.length, max: ENDPOINT.maxChars });
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new TranslateError('tr.err.offline');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const out = (await ENDPOINT.translate(source, from, to, ctrl.signal)).trim();
    const cache = readCache();
    cache[cacheKey(source, from, to)] = out;
    writeCache(cache);
    return out;
  } finally {
    clearTimeout(timer);
  }
}
