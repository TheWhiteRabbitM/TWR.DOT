/**
 * Things this device remembers, kept where they will actually survive.
 *
 * THE PROBLEM NOBODY NOTICES UNTIL IT BITES.
 * An app published to Bulletin is served from its content hash. Publish a new
 * build and the hash changes — and with it, in most containers, the ORIGIN. A
 * new origin gets a new, empty `localStorage`. So every preference an app keeps
 * the ordinary way is quietly wiped by its own next release: bookmarks, mutes,
 * which notifications you have already seen, whether you refused something.
 * Nothing errors, nothing warns; people simply find their settings reset and
 * assume they did it. We published several times a day for a week before this
 * was even suspected.
 *
 * The host has storage of its own — `getHostLocalStorage()` — and it belongs to
 * the HOST, not to the page. It outlives the origin, and it outlives clearing
 * the browser. That is the right home for anything a person would be annoyed to
 * lose.
 *
 * THE SHAPE THIS TAKES.
 * Host storage is asynchronous and the app reads these values while rendering,
 * which is not. So `localStorage` stays as the synchronous working copy and the
 * host is the durable one:
 *
 *   boot   → read the host, seed localStorage from it when the local copy is
 *            missing or older
 *   write  → localStorage now (so the next render sees it), host in the
 *            background
 *
 * The result is that the fast path never changes and the data stops evaporating.
 * Outside a container there is no host, everything falls back to localStorage,
 * and nothing here fails loudly — losing a bookmark must never break a timeline.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostStore = { readString(k: string): Promise<string>; writeString(k: string, v: string): Promise<void> };

let host: Promise<HostStore | null> | null = null;
function hostStore(): Promise<HostStore | null> {
  if (!host) {
    host = import('@parity/product-sdk-host')
      .then((h) => h.getHostLocalStorage() as unknown as Promise<HostStore | null>)
      .catch(() => null);
  }
  return host;
}

/** Every key we keep, so boot can hydrate them in one pass. */
const KEYS = [
  'chirp.marks',      // bookmarks
  'chirp.muted',      // muted masks
  'chirp.seen',       // notification watermark
  'chirp.pushed',     // last id pushed to the OS
  'chirp.push',       // whether notifications were allowed or refused
  'chirp.nolegacy',   // this host cannot sign with a wallet account
  'chirp.draft',      // an unsent chirp
  'chirp.lists',      // curated timelines: name -> masks
  'chirp.theme',      // light/dark, when the reader overrode the host
  'chirp.mutewords',  // words that keep a chirp out of the timeline
] as const;

const local = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/**
 * Copy anything the host is holding into this origin's storage.
 *
 * Called once, before the first render that reads any of it. The host wins on a
 * fresh origin — which is exactly the case this exists for. When both have a
 * value the LOCAL one wins, because it is the one the person has been changing
 * on this device, and overwriting it with a stale host copy would be its own
 * kind of data loss.
 */
export async function hydrate(): Promise<void> {
  const h = await hostStore();
  if (!h) return;
  await Promise.all(KEYS.map(async (k) => {
    if (local.get(k) !== null) return;              // this device already knows
    const v = await h.readString(k).catch(() => '');
    if (v) local.set(k, v);
  }));
}

/** Write through: fast copy first, durable copy in the background. */
export function keep(key: string, value: string): void {
  local.set(key, value);
  void hostStore().then((h) => h?.writeString(key, value).catch(() => undefined));
}

export const recall = (key: string): string | null => local.get(key);

/** Is the durable store actually here? For the settings screen to say so. */
export async function durable(): Promise<boolean> {
  return Boolean(await hostStore());
}
