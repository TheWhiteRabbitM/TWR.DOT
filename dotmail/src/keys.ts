/**
 * keys.ts — where a mailbox's private key comes from, and why it is never stored.
 *
 * THE HOST DERIVES IT, WE DO NOT KEEP IT
 *   `deriveEntropy(label)` returns bytes the host derives from the user's own
 *   account, deterministically, scoped to this app. So the same person on a new
 *   phone re-derives the same mailbox key by signing in, and we never write a
 *   private key anywhere. Nothing to leak, nothing to back up, nothing to lose
 *   when a device is lost — the properties a mail system most needs and least
 *   often has.
 *
 * OUTSIDE THE CONTAINER
 *   A plain browser has no host, so there is nothing to derive from. Rather
 *   than refuse to run, a random key is generated and kept in host storage
 *   under a name that says what it is. That key is for trying the app, and the
 *   interface says so: a demonstration mailbox is not a mailbox.
 *
 * WHY HOST STORAGE AND NOT localStorage
 *   An app is served from its content hash, so publishing a new build changes
 *   the origin and localStorage starts empty. Every preference kept the obvious
 *   way is wiped by the app's own next release. `getHostLocalStorage()` survives.
 */
import { x25519 } from '@noble/curves/ed25519.js';

const LABEL = 'dotmail:x25519:v1';
const DEV_SEED = 'dotmail.devseed';

export type Mailbox = {
  priv: Uint8Array;
  pub: Uint8Array;
  /** `host` when the key came from the account, `local` when it is a trial key
   *  this browser invented. Shown to the user, never hidden. */
  origin: 'host' | 'local';
};

async function host() {
  return import('@parity/product-sdk-host').catch(() => null);
}

/** Host storage, with a localStorage fallback so development works. */
async function store() {
  const h = await host();
  try {
    const s = h && (await h.getHostLocalStorage());
    if (s) {
      return {
        // readString answers "" for an absent key, so absence and an empty
        // value are the same thing here. Both mean "no seed yet".
        get: async (k: string) => (await s.readString(k)) || null,
        set: async (k: string, v: string) => { await s.writeString(k, v); },
      };
    }
  } catch { /* fall through to the browser */ }
  return {
    get: async (k: string) => localStorage.getItem(k),
    set: async (k: string, v: string) => { localStorage.setItem(k, v); },
  };
}

const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));

let cached: Mailbox | null = null;

/**
 * The mailbox for whoever is signed in.
 *
 * Cached for the session because deriving twice would ask the host twice for
 * the same answer, but never persisted: the point is that it can always be
 * derived again.
 */
export async function mailbox(): Promise<Mailbox> {
  if (cached) return cached;

  const h = await host();
  if (h) {
    try {
      const r = await h.deriveEntropy(new TextEncoder().encode(LABEL));
      // The SDK's Result: `ok` carries the bytes. A host that cannot derive is
      // not an error to hide — it just means we fall through to a trial key.
      const bytes = (r as { value?: Uint8Array })?.value;
      if (bytes && bytes.length >= 32) {
        const priv = bytes.slice(0, 32);
        cached = { priv, pub: x25519.getPublicKey(priv), origin: 'host' };
        return cached;
      }
    } catch { /* no host derivation here; trial key below */ }
  }

  const s = await store();
  let seed = await s.get(DEV_SEED);
  if (!seed || seed.length !== 64) {
    seed = hex(x25519.utils.randomSecretKey());
    await s.set(DEV_SEED, seed);
  }
  const priv = unhex(seed);
  cached = { priv, pub: x25519.getPublicKey(priv), origin: 'local' };
  return cached;
}

/** Forget the session's cached mailbox. Used when the signed-in account
 *  changes, because continuing with the previous key would silently show one
 *  person another person's mail. */
export function forgetMailbox() {
  cached = null;
}

export { hex, unhex };
