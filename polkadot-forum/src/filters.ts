/**
 * Personal filters — moderation without a moderator.
 *
 * The forum has no delete button and never will. What it has instead is this:
 * every reader decides what reaches their own eyes. Mute a mask, mute a word,
 * and the post is COLLAPSED for you — still on chain, still there for everyone
 * else, still one click away if you change your mind. Nothing is removed.
 *
 * This is the layer that works from day one, with a single active user and no
 * jury, no quorum and no stake. A dispute court only makes sense once there is a
 * crowd to populate it; filters help immediately.
 *
 * Lists live in localStorage and can be exported/imported as text, so people can
 * pass their list to someone who trusts their judgement. Sharing lists on chain
 * is the natural next step; it is not needed for this to be useful.
 */

const KEY = 'forum.filters.v1';

export interface Filters {
  /** Muted mask ids, as decimal strings (masks are bigint on chain). */
  masks: string[];
  /** Lowercased substrings; a post containing any of them is collapsed. */
  words: string[];
}

const empty = (): Filters => ({ masks: [], words: [] });

let cache: Filters | null = null;
const listeners = new Set<() => void>();

export function getFilters(): Filters {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Filters>) : null;
    cache = {
      masks: Array.isArray(parsed?.masks) ? parsed!.masks.map(String) : [],
      words: Array.isArray(parsed?.words) ? parsed!.words.map((w) => String(w).toLowerCase()) : [],
    };
  } catch {
    cache = empty();
  }
  return cache;
}

function commit(next: Filters) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: filters still work for this session */
  }
  for (const fn of listeners) fn();
}

/** Subscribe to filter changes (so every open view re-renders at once). */
export function onFiltersChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------- mutations -- */

export function muteMask(mask: bigint | string) {
  const id = String(mask);
  const f = getFilters();
  if (f.masks.includes(id)) return;
  commit({ ...f, masks: [...f.masks, id] });
}
export function unmuteMask(mask: bigint | string) {
  const id = String(mask);
  const f = getFilters();
  commit({ ...f, masks: f.masks.filter((m) => m !== id) });
}
export function muteWord(word: string) {
  const w = word.trim().toLowerCase();
  const f = getFilters();
  if (!w || f.words.includes(w)) return;
  commit({ ...f, words: [...f.words, w] });
}
export function unmuteWord(word: string) {
  const w = word.trim().toLowerCase();
  const f = getFilters();
  commit({ ...f, words: f.words.filter((x) => x !== w) });
}
export function clearFilters() {
  commit(empty());
}

/* --------------------------------------------------------------- queries -- */

export function isMaskMuted(mask: bigint | string): boolean {
  return getFilters().masks.includes(String(mask));
}

/** Why this post is hidden for this reader, or null when it is not. */
export function hiddenReason(post: { mask?: bigint | string | null; title?: string; body?: string }): string | null {
  const f = getFilters();
  if (post.mask != null && f.masks.includes(String(post.mask))) return `muted mask #${post.mask}`;
  if (f.words.length) {
    const hay = `${post.title ?? ''} ${post.body ?? ''}`.toLowerCase();
    const hit = f.words.find((w) => hay.includes(w));
    if (hit) return `muted word “${hit}”`;
  }
  return null;
}

/* ------------------------------------------------------------ share list -- */

/** A list as portable text — hand it to someone who trusts your judgement. */
export function exportFilters(): string {
  const f = getFilters();
  return JSON.stringify({ v: 1, masks: f.masks, words: f.words });
}

/** Merge an imported list into the current one (union, never destructive). */
export function importFilters(text: string): { masks: number; words: number } {
  const parsed = JSON.parse(text) as Partial<Filters>;
  const f = getFilters();
  const masks = [...new Set([...f.masks, ...(parsed.masks ?? []).map(String)])];
  const words = [...new Set([...f.words, ...(parsed.words ?? []).map((w) => String(w).toLowerCase())])];
  commit({ masks, words });
  return { masks: masks.length - f.masks.length, words: words.length - f.words.length };
}
