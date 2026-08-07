/**
 * seal.ts — the whole privacy argument of dotmail, in one file.
 *
 * THE PROBLEM
 *   A mailbox on a public chain is easy to build and terrible to use: `to` and
 *   `from` in the clear, unforgeable, permanent. Email at least loses its
 *   metadata only to the provider. So no envelope here names a recipient.
 *
 * ADDRESSING WITHOUT NAMING
 *   The recipient publishes an X25519 public key R. The sender makes a
 *   THROWAWAY keypair (e, E), derives s = X25519(e, R), and writes
 *
 *     tag = H("dotmail:tag:v2" ++ s)
 *
 *   which only R's holder can recompute, by trying each envelope in turn. An
 *   observer sees a river of blobs and cannot say whose any of them are.
 *
 * WHY THERE ARE FOUR SLOTS, ALWAYS
 *   A letter you send is sealed to the RECIPIENT's key, so you cannot read it
 *   afterwards. "Sent" therefore is not a folder you filter into: it is a
 *   second sealing, to yourself. Doing that as a second envelope would double
 *   the storage and the cost, so instead the body is encrypted ONCE under a
 *   random content key, and that small key is wrapped separately for each
 *   reader. Sender included, which is what makes Sent work at all.
 *
 *   Every envelope carries exactly FOUR slots whether or not it needs them,
 *   and the spare ones are filled with random bytes indistinguishable from
 *   real ones. A variable count would publish how many people a letter went
 *   to, and "this one had four recipients" is precisely the sort of metadata
 *   this file exists to withhold. Uniformity costs ~300 bytes and leaks nothing.
 *
 * WHAT IS STILL PUBLIC, SAID HERE RATHER THAN DISCOVERED LATER
 *   Whoever pays. A transaction has a signer. So "somebody wrote to someone"
 *   is public; who they wrote to is not.
 *
 * THE SUBJECT IS NOT A FIELD
 *   It is inside the seal with the body. A subject line is the most revealing
 *   short string a message has.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';

export const SLOTS = 4;
export const TAG_CTX = 'dotmail:tag:v2';
export const KEY_CTX = 'dotmail:key:v2';
export const WRAP_CTX = 'dotmail:wrap:v2';
const NONCE = 24;
const WRAPPED = 32 + 16;             // content key + Poly1305 tag

import type { Attachment, Part } from './attach.ts';

export type Letter = {
  kind?: 'letter';
  /** The sender's name, as CLAIMED. The payer on chain is the fact. */
  from: string;
  to: string;
  subject: string;
  body: string;
  replyTo?: number;
  attachments?: Attachment[];
  /**
   * A file that is too big to live in the envelope, sitting on Bulletin
   * instead, with the key that opens it right here.
   *
   * ADDITIVE ON PURPOSE. A client that knows nothing about this field still
   * shows the body, and the body says in words what the file is and when it
   * expires. The alternative, a new payload `kind`, would render in every
   * older client as a letter with no text: a working send that looks broken,
   * which is the worst failure available.
   */
  file?: import('./file.ts').Stored;
  sentAt: number;
};

/**
 * What a sealed envelope contains: a letter, or one slice of a picture too big
 * to fit in one. Both are sealed identically, so a slice is as unreadable and
 * as unattributable as the letter it belongs to, and the reader tells them
 * apart only after opening.
 */
export type Payload = Letter | Part;

export const isPart = (p: Payload): p is Part => (p as Part).kind === 'part';

const enc = new TextEncoder();
const dec = new TextDecoder();

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const h32 = (ctx: string, ...parts: Uint8Array[]) => blake2b(cat(enc.encode(ctx), ...parts), { dkLen: 32 });
const h24 = (ctx: string, ...parts: Uint8Array[]) => blake2b(cat(enc.encode(ctx), ...parts), { dkLen: 24 });

/** Everything an envelope carries. `tags` is always SLOTS long. */
export type Envelope = {
  tags: Uint8Array[];
  eph: Uint8Array;
  /** SLOTS wrapped content keys, then the nonce, then the body ciphertext. */
  sealed: Uint8Array;
};

/**
 * Seal one letter for several readers at once.
 *
 * `readers` must include the sender's own key if they want it in Sent. The
 * caller decides that rather than this function assuming it, because a letter
 * you deliberately cannot re-read later is a legitimate thing to want.
 */
export function seal(letter: Payload, readers: Uint8Array[]): Envelope {
  if (!readers.length) throw new Error('a letter needs at least one reader');
  if (readers.length > SLOTS) throw new Error(`at most ${SLOTS} readers`);
  for (const r of readers) if (r.length !== 32) throw new Error('keys must be 32 bytes');

  const ephPriv = x25519.utils.randomSecretKey();
  const eph = x25519.getPublicKey(ephPriv);
  const contentKey = randomBytes(32);

  const tags: Uint8Array[] = [];
  const wrapped: Uint8Array[] = [];
  for (const r of readers) {
    const s = x25519.getSharedSecret(ephPriv, r);
    tags.push(h32(TAG_CTX, s));
    // The wrap nonce is derived, not stored: s is unique per (eph, reader), so
    // it can never repeat, and 24 bytes per slot are saved.
    wrapped.push(xchacha20poly1305(h32(KEY_CTX, s, eph, r), h24(WRAP_CTX, s)).encrypt(contentKey));
  }
  // Pad to a fixed shape. Random, not zeroes: a zeroed slot would announce
  // itself as unused and publish the recipient count.
  while (tags.length < SLOTS) { tags.push(randomBytes(32)); wrapped.push(randomBytes(WRAPPED)); }

  const bodyNonce = randomBytes(NONCE);
  const body = xchacha20poly1305(contentKey, bodyNonce).encrypt(enc.encode(JSON.stringify(letter)));

  return { tags, eph, sealed: cat(...wrapped, bodyNonce, body) };
}

/** Which slot, if any, is mine. `-1` for none: one X25519 and four compares. */
export function slotFor(env: Pick<Envelope, 'tags' | 'eph'>, myPriv: Uint8Array): number {
  if (env.eph.length !== 32) return -1;
  let s: Uint8Array;
  try { s = x25519.getSharedSecret(myPriv, env.eph); } catch { return -1; }
  const want = h32(TAG_CTX, s);
  for (let i = 0; i < env.tags.length; i++) {
    const t = env.tags[i];
    if (t.length !== 32) continue;
    let same = true;
    for (let j = 0; j < 32; j++) if (t[j] !== want[j]) { same = false; break; }
    if (same) return i;
  }
  return -1;
}

/** Open an envelope whose slot already matched. `null` when the bytes do not
 *  authenticate, which is a forgery or a bad read and never a letter to show. */
export function open(env: Envelope, slot: number, myPriv: Uint8Array, myPub: Uint8Array): Payload | null {
  try {
    const s = x25519.getSharedSecret(myPriv, env.eph);
    const wrapped = env.sealed.subarray(slot * WRAPPED, (slot + 1) * WRAPPED);
    const contentKey = xchacha20poly1305(h32(KEY_CTX, s, env.eph, myPub), h24(WRAP_CTX, s)).decrypt(wrapped);

    const at = SLOTS * WRAPPED;
    const nonce = env.sealed.subarray(at, at + NONCE);
    const body = env.sealed.subarray(at + NONCE);
    const payload = JSON.parse(dec.decode(xchacha20poly1305(contentKey, nonce).decrypt(body))) as Payload;

    // Authenticated bytes that are not a shape we recognise are still not a
    // letter. Better to drop them than to render half an object.
    if (isPart(payload)) {
      return typeof payload.data === 'string' && Number.isInteger(payload.total) ? payload : null;
    }
    if (typeof payload?.body !== 'string' || typeof payload?.subject !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Sealed size, so the composer can warn before the contract refuses. */
export function sealedSize(letter: Payload): number {
  return SLOTS * WRAPPED + NONCE + enc.encode(JSON.stringify(letter)).length + 16;
}
