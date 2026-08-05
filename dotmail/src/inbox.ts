/**
 * inbox.ts — finding your own mail in a stream that names nobody.
 *
 * THE COST OF THE PRIVACY
 *   Because no envelope says who it is for, reading a mailbox means trying
 *   every envelope: one X25519 and one hash each, measured at 0.63 ms. That is
 *   cheap per envelope and unbounded over time, so this does three things:
 *
 *     1. Reads TAGS in pages, never bodies. A scan moves 64 bytes per envelope
 *        instead of a whole letter.
 *     2. Fetches bodies only for the handful that matched.
 *     3. Remembers how far it has scanned, so the second visit starts where the
 *        first stopped instead of re-testing the entire history.
 *
 *   The high-water mark is the difference between an inbox that gets slower
 *   forever and one that does a little work per new letter.
 */
import { mine, open, type Letter } from './seal.ts';
import type { MailStore } from './store.ts';
import type { Mailbox } from './keys.ts';

export type Received = Letter & {
  id: number;
  /** The account that paid for the transaction. Public, and the only sender
   *  fact this app did not take somebody's word for. */
  payer: string;
  /** True when the claimed `from` name really is owned by `payer`. `null` when
   *  the ownership lookup could not be made — not the same as false. */
  fromVerified: boolean | null;
  receivedAt: number;
};

const PAGE = 500;

export type ScanProgress = { scanned: number; total: number; found: number };

/**
 * Walk the store from `start`, returning the letters that are ours.
 *
 * Never throws for an unreadable store: it returns what it managed, plus the
 * point it got to, so a caller can retry from there rather than start over or,
 * worse, present a partial scan as an empty inbox.
 */
export async function scan(
  store: MailStore,
  box: Mailbox,
  start: number,
  onProgress?: (p: ScanProgress) => void,
): Promise<{ letters: Received[]; scannedTo: number; complete: boolean }> {
  const total = await store.count();
  if (total === null) return { letters: [], scannedTo: start, complete: false };

  const letters: Received[] = [];
  let at = Math.min(start, total);

  while (at < total) {
    const heads = await store.heads(at, Math.min(PAGE, total - at));
    if (heads === null) {
      // The chain refused a read. Stop where we are and say so; pretending the
      // rest of the stream is empty is the bug class this project keeps meeting.
      return { letters, scannedTo: at, complete: false };
    }

    const hits = heads.filter((h) => mine(h.eph, h.tag, box.priv));
    if (hits.length) {
      const bodies = await store.bodies(hits.map((h) => h.id));
      if (bodies) {
        for (const b of bodies) {
          const head = hits.find((h) => h.id === b.id);
          if (!head) continue;
          const letter = open({ tag: head.tag, eph: head.eph, sealed: b.sealed }, box.priv, box.pub);
          // A tag that matched but a body that will not authenticate is either
          // corruption or somebody's idea of a joke. Either way it is not a
          // letter, and it is not shown.
          if (!letter) continue;
          letters.push({
            ...letter,
            id: b.id,
            payer: b.from,
            fromVerified: null,          // filled in by the caller, which can ask DotNS
            receivedAt: b.time,
          });
        }
      }
    }

    at += heads.length;
    onProgress?.({ scanned: at, total, found: letters.length });
    if (!heads.length) break;            // a store that stops answering
  }

  return { letters, scannedTo: at, complete: true };
}

/** Newest first, which is the only order an inbox is ever wanted in. */
export const byNewest = (a: Received, b: Received) => b.receivedAt - a.receivedAt || b.id - a.id;

/**
 * Group into threads by the chain of `replyTo`.
 *
 * Threading on the SUBJECT, the way mail clients traditionally do, cannot work
 * here: the subject is inside the seal, so nobody without the key can group
 * anything — which is the point. Explicit ids are the only link available, and
 * they are inside the seal too.
 */
export function threads(letters: Received[]): Received[][] {
  const byId = new Map(letters.map((l) => [l.id, l]));
  const root = (l: Received): number => {
    let cur = l;
    const seen = new Set<number>();
    while (cur.replyTo !== undefined && byId.has(cur.replyTo) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.replyTo)!;
    }
    return cur.id;
  };
  const groups = new Map<number, Received[]>();
  for (const l of letters) {
    const r = root(l);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(l);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => a.receivedAt - b.receivedAt))
    .sort((a, b) => byNewest(a[a.length - 1], b[b.length - 1]));
}
