/**
 * file.ts — a file, sealed, and the note that says where it is.
 *
 * THE SPLIT THAT MAKES THIS WORK
 *   The FILE goes to Bulletin, which is content-addressed and holds megabytes
 *   for nothing. The KEY never goes near it. The key travels inside a dotmail
 *   envelope, which is sealed to the recipient's mailbox key and names nobody.
 *
 *   So Bulletin holds bytes that are unreadable and unattributable, and the
 *   chain holds an envelope that says nothing about what it points at. Neither
 *   half is worth anything on its own, which is the property we want.
 *
 * WHY NOT PUT THE FILE IN THE ENVELOPE
 *   Because it was tried and it is unusable. dotmail seals attachments into
 *   the letter itself, in slices of 9000 bytes, one transaction per slice, and
 *   refuses any image that will not compress under 90 kB. A 400 kB file is 45
 *   transactions and 45 wallet prompts. Through Bulletin the same file is one
 *   upload, measured, and costs no chain storage at all.
 *
 * THE THING THAT MUST BE SAID OUT LOUD
 *   `RetentionPeriod` on the Bulletin chain reads 201600 blocks. At six
 *   seconds a block that is FOURTEEN DAYS. This is not permanent storage and
 *   an app that implies it is would be lying. Every file carries the block
 *   it must be renewed by, the interface shows it as a date, and a file past
 *   that date is reported as gone rather than shown as a broken link.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';

/** Read off the Bulletin chain, not assumed: `TransactionStorage.RetentionPeriod`. */
export const RETENTION_BLOCKS = 201_600;
export const BLOCK_SECONDS = 6;
export const RETENTION_MS = RETENTION_BLOCKS * BLOCK_SECONDS * 1000;

/** `MaxTransactionSize` on the same chain. Bigger files are chunked by the SDK
 *  into a DAG, but a single part can never exceed this. */
export const MAX_CHUNK = 2 * 1024 * 1024;

/**
 * What the recipient is told. Small enough to fit inside a sealed envelope
 * with room to spare, because it is only a pointer and a key.
 */
export type Stored = {
  kind: 'file';
  /** Where the bytes are. Public, but they are ciphertext. */
  cid: string;
  /** 32 bytes, hex. The only thing that opens it, and it is never on Bulletin. */
  key: string;
  name: string;
  type: string;
  /** Of the PLAINTEXT, so the recipient can be told what they are about to get
   *  before fetching a megabyte of it. */
  size: number;
  /** Milliseconds. When the bytes stop being retrievable unless renewed. */
  expires: number;
  note?: string;
  sentAt: number;
};

export const isStored = (p: unknown): p is Stored =>
  !!p && typeof p === 'object' && (p as Stored).kind === 'file';

const NONCE = 24;
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) =>
  new Uint8Array((s.replace(/^0x/i, '').match(/../g) ?? []).map((b) => parseInt(b, 16)));

/**
 * Seal a file's bytes under a fresh key.
 *
 * The nonce goes FIRST in the blob rather than beside it, so the whole of what
 * a reader needs is the key: one string to carry, one string to lose. A nonce
 * kept separately is a second thing to get wrong for no gain.
 */
export function sealBytes(plain: Uint8Array): { blob: Uint8Array; key: string } {
  const key = randomBytes(32);
  const nonce = randomBytes(NONCE);
  const body = xchacha20poly1305(key, nonce).encrypt(plain);
  const blob = new Uint8Array(NONCE + body.length);
  blob.set(nonce, 0);
  blob.set(body, NONCE);
  return { blob, key: hex(key) };
}

/**
 * Open what came back from Bulletin.
 *
 * Returns null rather than throwing on a bad tag, because the caller has to
 * tell three things apart and an exception collapses them: wrong key, damaged
 * bytes, and a fetch that returned something that is not a file at all.
 */
export function openBytes(blob: Uint8Array, keyHex: string): Uint8Array | null {
  try {
    const key = unhex(keyHex);
    if (key.length !== 32 || blob.length <= NONCE) return null;
    return xchacha20poly1305(key, blob.slice(0, NONCE)).decrypt(blob.slice(NONCE));
  } catch {
    return null;
  }
}

/** Ciphertext overhead, so the interface can quote a real cost before upload. */
export const sealedSize = (plain: number) => plain + NONCE + 16;

export const expiryFromNow = () => Date.now() + RETENTION_MS;

/** How long a file has left, said the way a person would say it. */
export function timeLeft(expires: number, now = Date.now()): string {
  const ms = expires - now;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days left`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 2) return `${hours} hours left`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins} minute${mins === 1 ? '' : 's'} left`;
}

export const isExpired = (p: Pick<Stored, 'expires'>, now = Date.now()) => p.expires <= now;

/** Bytes, for people. */
export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
