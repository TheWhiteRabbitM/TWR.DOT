import { meAt, ratingOf, reviewsOf, type Review } from './chain';

/**
 * Reviews, as the store shows them: whatever the contract holds, plus — outside
 * the Polkadot app, where nothing can be signed — the reader's own review kept
 * on this device and labelled as such.
 *
 * The rule that matters: a local review is NEVER presented as on-chain. It is
 * stored separately, rendered with its own label, and it never contributes to
 * the average, because the average is a chain fact.
 */

const LOCAL_KEY = 'dotstore.local.v1';

export interface LocalReview {
  label: string;
  rating: number;
  body: string;
  at: number;
}

export function localReviews(): Record<string, LocalReview> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, LocalReview>;
  } catch {
    return {};
  }
}

export function saveLocalReview(r: LocalReview): void {
  try {
    const all = localReviews();
    all[r.label] = r;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* a full quota must not break posting */
  }
}

export interface AppRating {
  /** Mean of on-chain ratings, or null when there are none. */
  avg: number | null;
  count: number;
}

const cache = new Map<string, AppRating>();

/**
 * Ratings for many apps at once, politely: a few at a time rather than seventy
 * parallel calls at one public RPC endpoint. Results are cached for the session
 * — a rating changes when someone reviews, not between two scrolls.
 */
export async function ratingsFor(keys: string[], concurrency = 4): Promise<Map<string, AppRating>> {
  const todo = keys.filter((k) => !cache.has(k));
  let i = 0;
  async function worker(): Promise<void> {
    while (i < todo.length) {
      const key = todo[i++];
      const r = await ratingOf(key);
      cache.set(key, r && r.count > 0 ? { avg: r.sum / r.count, count: r.count } : { avg: null, count: 0 });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return cache;
}

export function cachedRating(key: string): AppRating | undefined {
  return cache.get(key);
}

/** Forget an app's cached rating, so the next read reflects a fresh review. */
export function invalidate(key: string): void {
  cache.delete(key);
}

/**
 * Re-read one app's rating after a review was posted, and keep asking until the
 * number actually moves.
 *
 * A transaction that has been accepted is not yet a transaction that has been
 * included, so an immediate re-read usually returns the old figure. Polling for
 * a bounded stretch is the difference between the page updating itself and the
 * reader concluding nothing happened. It gives up quietly: the review is on
 * chain either way, and the next visit will show it.
 */
export async function refreshRating(key: string, attempts = 8, gapMs = 3000): Promise<AppRating> {
  const before = cache.get(key)?.count ?? 0;
  let latest: AppRating = { avg: null, count: 0 };
  for (let i = 0; i < attempts; i++) {
    cache.delete(key);
    const r = await ratingOf(key);
    latest =
      r && r.count > 0 ? { avg: r.sum / r.count, count: r.count } : { avg: null, count: 0 };
    cache.set(key, latest);
    if (latest.count > before) return latest;
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, gapMs));
  }
  return latest;
}

export async function reviewsFor(key: string): Promise<Review[]> {
  return reviewsOf(key, 0, 50);
}

export async function whoAmI(account: string, key: string) {
  return meAt(account, key);
}

export type { Review };
