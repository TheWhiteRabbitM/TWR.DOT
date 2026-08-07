/**
 * mine.ts — the list of what you have put up there.
 *
 * WHY THIS IS LOCAL AND NOT ON A CHAIN
 *   A file's CID is public bytes and its key is not. Writing "this account
 *   owns this CID" anywhere public would hand an observer the one link the
 *   whole design is built to withhold: which account put which blob up. The
 *   blob is unattributable precisely because nothing says who uploaded it.
 *
 *   So the index of your own files lives on your device. The cost is real and
 *   is stated in the interface: a new device starts with an empty list, and a
 *   file whose key you did not keep is gone even though the bytes are still
 *   there. That is the same bargain as a physical key to a locker.
 *
 * WHY HOST STORAGE AND NOT localStorage
 *   An app is served from its content hash, so publishing a new build changes
 *   the origin and localStorage starts empty. Every list kept the obvious way
 *   is wiped by the app's own next release.
 */
import type { Stored } from './file.ts';

const KEY = 'dot-drive.files';

/** What we keep about a file, which is the pointer plus the key plus enough
 *  to describe it without fetching a megabyte to find out its name. */
export type Mine = Stored & {
  /** Who it was sent to, if it was. A handle, for display only. */
  sentTo?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function host(): Promise<any> {
  try {
    const h = await import('@parity/product-sdk-host');
    return (await h.getHostLocalStorage?.()) ?? null;
  } catch {
    return null;
  }
}

/** Falls back to the browser's own storage OUTSIDE the container, where there
 *  is no host to ask. It is the wrong store for a published build and the
 *  right one for a dev server, and the difference is invisible from here. */
async function read(): Promise<string> {
  const h = await host();
  // readString, NOT get. The host storage API is readString/writeString and
  // an absent key answers '', so a wrong method name threw and fell silently
  // through to the browser store, which a new publish wipes.
  if (h) { try { return (await h.readString(KEY)) ?? ''; } catch { /* fall through */ } }
  try { return globalThis.localStorage?.getItem(KEY) ?? ''; } catch { return ''; }
}

async function write(v: string): Promise<void> {
  const h = await host();
  if (h) { try { await h.writeString(KEY, v); return; } catch { /* fall through */ } }
  try { globalThis.localStorage?.setItem(KEY, v); } catch { /* nowhere to put it */ }
}

export async function list(): Promise<Mine[]> {
  try {
    const raw = await read();
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as Mine[]).filter((x) => x && typeof x.cid === 'string') : [];
  } catch {
    // A corrupt list is not an empty list, but there is nothing useful to do
    // with half a JSON array, and refusing to start would be worse.
    return [];
  }
}

export async function remember(f: Mine): Promise<void> {
  const all = await list();
  // Same CID twice is the same bytes twice: keep the newer record, which has
  // the later expiry, rather than showing one file as two.
  const rest = all.filter((x) => x.cid !== f.cid);
  await write(JSON.stringify([f, ...rest].slice(0, 500)));
}

export async function forget(cid: string): Promise<void> {
  const all = await list();
  await write(JSON.stringify(all.filter((x) => x.cid !== cid)));
}

/** Mark a file as having been sent, so the list can say so. */
export async function markSent(cid: string, to: string): Promise<void> {
  const all = await list();
  const f = all.find((x) => x.cid === cid);
  if (!f) return;
  f.sentTo = to;
  await write(JSON.stringify(all));
}
