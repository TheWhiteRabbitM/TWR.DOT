/**
 * inbox.ts — finding your own mail in a stream that names nobody, and sorting
 * it into the folders people expect.
 *
 * THE COST OF THE PRIVACY
 *   Because no envelope says who it is for, reading a mailbox means trying
 *   every envelope: one X25519 and four compares each, measured at 0.59 ms.
 *   Cheap per envelope and unbounded over time, so this reads TAGS in pages
 *   rather than bodies, fetches bodies only for what matched, and remembers
 *   how far it scanned so a second visit does a little work rather than all of
 *   it again.
 *
 * INBOX VERSUS SENT
 *   Both are found the same way: a slot that matches your key. What separates
 *   them is who paid, which is the one sender fact the chain records. Your own
 *   address on the envelope means you wrote it.
 */
import { slotFor, open, isPart, type Letter, type Envelope } from './seal.ts';
import type { Part } from './attach.ts';
import type { MailStore } from './store.ts';
import type { Mailbox } from './keys.ts';

export type Received = Letter & {
  id: number;
  /** The account that paid. Public, and the only sender fact not taken on trust. */
  payer: string;
  /** Did we pay for this one? Then it belongs in Sent. */
  outgoing: boolean;
  receivedAt: number;
};

const PAGE = 500;
export type ScanProgress = { scanned: number; total: number; found: number };

/**
 * Did we pay for this letter? The one line that decides Inbox from Sent.
 *
 * Pulled out and exported so it can be tested, because it was wrong for as
 * long as it was one inline `===` nobody could get at: the two addresses are
 * built in different places and only ever agreed on their bytes.
 *
 * `me()` writes its hex with `toString(16)`, which is lowercase. The payer
 * arrives from the chain through `asHex()`, which is EIP-55 checksummed. So
 * `0xc40c…` and `0xC40c…` were never equal, every letter this account sent
 * failed the test, and all of them filed into Inbox while Sent sat empty.
 *
 * An unknown `me` means nothing is outgoing. If we could not learn who we are,
 * an empty Sent is the honest answer and a guess is not.
 */
export const isMine = (payer: string, me: string) =>
  !!me && !!payer && payer.toLowerCase() === me.toLowerCase();

export async function scan(
  store: MailStore,
  box: Mailbox,
  onProgress?: (p: ScanProgress) => void,
): Promise<{ letters: Received[]; parts: Map<string, Part[]>; scannedTo: number; complete: boolean }> {
  const total = await store.count();
  if (total === null) return { letters: [], parts: new Map(), scannedTo: 0, complete: false };

  const me = (await store.me()) ?? '';
  const letters: Received[] = [];
  /** Slices of pictures, kept aside by group rather than shown as letters. */
  const parts = new Map<string, Part[]>();
  let at = 0;

  while (at < total) {
    const heads = await store.heads(at, Math.min(PAGE, total - at));
    if (heads === null) {
      // A refused read is not an empty stream. Stop, and say where we stopped.
      return { letters, parts, scannedTo: at, complete: false };
    }

    const hits: { id: number; slot: number; head: (typeof heads)[number] }[] = [];
    for (const h of heads) {
      const slot = slotFor(h, box.priv);
      if (slot >= 0) hits.push({ id: h.id, slot, head: h });
    }

    if (hits.length) {
      const bodies = await store.bodies(hits.map((h) => h.id));
      if (bodies) {
        for (const b of bodies) {
          const hit = hits.find((h) => h.id === b.id);
          if (!hit) continue;
          const env: Envelope = { tags: hit.head.tags, eph: hit.head.eph, sealed: b.sealed };
          const payload = open(env, hit.slot, box.priv, box.pub);
          // A slot that matched but a body that will not authenticate is a
          // forgery or a bad read. Either way it is not a letter, and it is
          // not shown to anybody.
          if (!payload) continue;
          // A slice of a picture. Set aside, never shown as an inbox row: an
          // inbox full of fragments is what this would be otherwise.
          if (isPart(payload)) {
            const list = parts.get(payload.group) ?? [];
            list.push(payload);
            parts.set(payload.group, list);
            continue;
          }
          const letter = payload;
          letters.push({
            ...letter,
            id: b.id,
            payer: b.from,
            outgoing: isMine(b.from, me),
            receivedAt: b.time,
          });
        }
      }
    }

    at += heads.length;
    onProgress?.({ scanned: at, total, found: letters.length });
    if (!heads.length) break;
  }

  return { letters, parts, scannedTo: at, complete: true };
}

export const byNewest = (a: Received, b: Received) => b.receivedAt - a.receivedAt || b.id - a.id;

/**
 * Group into conversations by the chain of `replyTo`.
 *
 * Threading on the subject, the way mail clients traditionally do, cannot work
 * here: the subject is inside the seal, so nobody without the key could group
 * anything, which is the point. Explicit ids are the only link, and they are
 * sealed too.
 */
export function threads(letters: Received[]): Received[][] {
  const byId = new Map(letters.map((l) => [l.id, l]));
  const rootOf = (l: Received): number => {
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
    const r = rootOf(l);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(l);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => a.receivedAt - b.receivedAt))
    .sort((a, b) => byNewest(a[a.length - 1], b[b.length - 1]));
}
