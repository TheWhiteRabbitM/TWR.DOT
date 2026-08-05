/**
 * seal.ts — the whole privacy argument of dotmail, in one file.
 *
 * THE PROBLEM THIS SOLVES
 *   A mailbox on a public chain is trivial to build and terrible to use: `to`
 *   and `from` in the clear, unforgeable and permanent. Email at least loses
 *   its metadata only to the provider. So the recipient is never named here.
 *
 * HOW A LETTER IS ADDRESSED WITHOUT NAMING ANYONE
 *   The recipient publishes an X25519 public key R (see keys.ts). To write to
 *   them the sender makes a THROWAWAY keypair (e, E), computes the shared
 *   secret s = X25519(e, R), and puts on chain:
 *
 *     tag     = H("dotmail:tag:v1" ++ s)      opaque to everyone but R's holder
 *     eph     = E                             a fresh key, unlinkable to anything
 *     sealed  = nonce ++ XChaCha20-Poly1305(k, plaintext)
 *
 *   To find their mail the recipient walks the stream computing
 *   s' = X25519(r, E) for each envelope and comparing tags. Only they can, so
 *   an observer sees a river of blobs and cannot say which are whose. This is
 *   the same shape as a stealth address: the cost is that reading is a scan,
 *   which is why the contract hands back tags in pages.
 *
 * WHAT IT DOES NOT HIDE, STATED HERE RATHER THAN DISCOVERED LATER
 *   The payer. A transaction has a signer, and that address is on chain. So
 *   "somebody wrote to someone" is public; "who they wrote to" is not.
 *
 * WHY THE SUBJECT IS NOT A FIELD
 *   It is inside the seal with the body. A subject line is the most revealing
 *   short string a message has, and a mailbox that publishes subjects while
 *   calling itself private is the failure mode worth avoiding most.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';

export const TAG_CTX = 'dotmail:tag:v1';
export const KEY_CTX = 'dotmail:key:v1';
const NONCE = 24;

/** What a letter actually is, once opened. Everything here is sealed. */
export type Letter = {
  /** The sender's .dot name, as CLAIMED. Verified against the on-chain payer
   *  by the reader (see verify.ts) rather than trusted on sight. */
  from: string;
  subject: string;
  body: string;
  /** Envelope id this replies to, for threading. */
  replyTo?: number;
  sentAt: number;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function cat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Domain-separated so a tag can never be mistaken for a key, or vice versa. */
const tagOf = (secret: Uint8Array) => blake2b(cat(enc.encode(TAG_CTX), secret), { dkLen: 32 });

/** Bound to BOTH public keys, not just the secret: it costs nothing and it
 *  removes a whole family of key-reuse mistakes. */
const keyOf = (secret: Uint8Array, eph: Uint8Array, recipient: Uint8Array) =>
  blake2b(cat(enc.encode(KEY_CTX), secret, eph, recipient), { dkLen: 32 });

export type Sealed = { tag: Uint8Array; eph: Uint8Array; sealed: Uint8Array };

/** Seal a letter to a recipient's published key. */
export function seal(letter: Letter, recipientPub: Uint8Array): Sealed {
  if (recipientPub.length !== 32) throw new Error('recipient key must be 32 bytes');
  const ephPriv = x25519.utils.randomSecretKey();
  const eph = x25519.getPublicKey(ephPriv);
  const secret = x25519.getSharedSecret(ephPriv, recipientPub);

  const nonce = randomBytes(NONCE);
  const ct = xchacha20poly1305(keyOf(secret, eph, recipientPub), nonce)
    .encrypt(enc.encode(JSON.stringify(letter)));

  return { tag: tagOf(secret), eph, sealed: cat(nonce, ct) };
}

/** Is this envelope mine? One X25519 and one hash, the whole cost of a scan. */
export function mine(eph: Uint8Array, tag: Uint8Array, myPriv: Uint8Array): boolean {
  if (eph.length !== 32 || tag.length !== 32) return false;
  let secret: Uint8Array;
  try { secret = x25519.getSharedSecret(myPriv, eph); } catch { return false; }
  const want = tagOf(secret);
  // Constant time is not the point here (the tag is public), but bailing on
  // the first differing byte is still the obvious way to write it.
  for (let i = 0; i < 32; i++) if (want[i] !== tag[i]) return false;
  return true;
}

/** Open an envelope already matched by {@link mine}. Returns null when the
 *  bytes do not authenticate, which is a forgery or a corrupt read, never a
 *  letter to show somebody. */
export function open(env: Sealed, myPriv: Uint8Array, myPub: Uint8Array): Letter | null {
  try {
    const secret = x25519.getSharedSecret(myPriv, env.eph);
    const nonce = env.sealed.subarray(0, NONCE);
    const ct = env.sealed.subarray(NONCE);
    const pt = xchacha20poly1305(keyOf(secret, env.eph, myPub), nonce).decrypt(ct);
    const letter = JSON.parse(dec.decode(pt)) as Letter;
    if (typeof letter?.body !== 'string' || typeof letter?.subject !== 'string') return null;
    return letter;
  } catch {
    return null;
  }
}

/** How big the sealed blob will be, so the composer can say so before sending
 *  rather than after the contract refuses it. */
export function sealedSize(letter: Letter): number {
  return NONCE + enc.encode(JSON.stringify(letter)).length + 16;   // +16 Poly1305 tag
}
