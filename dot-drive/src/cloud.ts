/**
 * cloud.ts — the one connection to Bulletin, and the honest truth about where
 * it works.
 *
 * CONTAINER ONLY, AND SAID SO
 *   The cloud storage SDK routes reads through the host's preimage
 *   subscription and signs writes with the host's wallet. Outside the Polkadot
 *   container there is no host, so BOTH halves fail. The SDK's own words:
 *   "container-only by design (no public-gateway fetches)".
 *
 *   So this module never pretends. `ready()` reports which of three states we
 *   are in, and the interface says which one rather than showing an upload
 *   button that cannot work.
 *
 * ONE APP INSTANCE
 *   `createApp` opens a chain client. Calling it twice is the mistake this
 *   codebase has made in three apps now: the second connection hangs for ever
 *   with no error, and half the screen keeps working, which is what makes it
 *   cost hours to spot. Cached as a PROMISE so two callers racing at startup
 *   share one attempt.
 */
import { RETENTION_MS } from './file.ts';

/** The app name every app in this suite passes, so the host derives ONE
 *  account and dot-drive is the same person as chirp, dotmail and peoplebook.
 *  Getting this wrong does not fail, it silently creates a second you. */
export const IDENTITY_DAPP = 'peoplebook.dot';

/** The Bulletin chain behind the devnet preset, kept here so a mismatch is
 *  visible rather than buried in an SDK default. */
export const BULLETIN_GENESIS =
  '0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59';

export type Cloud = {
  upload(bytes: Uint8Array): Promise<{ ok: true; cid: string } | { ok: false; why: string }>;
  fetch(cid: string): Promise<Uint8Array | null>;
  /** The account whose allowance pays for uploads, for display only. */
  account: string | null;
};

/** Three states, because "no host" and "host refused" need different words. */
export type Ready =
  | { kind: 'ready'; cloud: Cloud }
  /** Not in the container. Nothing here can work, and no button should suggest it can. */
  | { kind: 'nohost' }
  /** In the container, but the wallet or the chain would not come up. */
  | { kind: 'failed'; why: string };

let pending: Promise<Ready> | null = null;

async function connect(): Promise<Ready> {
  try {
    const host = await import('@parity/product-sdk-host');
    const inside = await host.isInsideContainer?.();
    if (inside === false) return { kind: 'nohost' };

    const sdk = await import('@parity/product-sdk');
    const app = await sdk.createApp({
      name: IDENTITY_DAPP,
      cloudStorage: { environment: 'devnet' },
    });
    if (!app.cloudStorage) return { kind: 'failed', why: 'this build has cloud storage turned off' };

    // Uploads are signed, so an account has to be selected first. Doing it
    // here rather than at the first upload means the permission sheet appears
    // when the app opens, not in the middle of sending somebody a file.
    let account: string | null = null;
    try {
      const w = await app.wallet.connect();
      account = w?.accounts?.[0]?.address ?? null;
    } catch { /* an upload will say so properly; reads may still work */ }

    const store = app.cloudStorage;
    const cloud: Cloud = {
      account,
      async upload(bytes) {
        try {
          // A plain tagged Result here: `{ok, value}` / `{ok, error}`. NOT the
          // neverthrow ResultAsync the accounts API hands back, which needs
          // `.match()` and answers `undefined` to `.value`.
          const r = await store.upload(bytes);
          if (r.ok) return { ok: true, cid: String(r.value) };
          return { ok: false, why: reason(r.error) };
        } catch (e) {
          return { ok: false, why: reason(e) };
        }
      },
      async fetch(cid) {
        try {
          const r = await store.fetch(cid);
          return r.ok ? new Uint8Array(r.value) : null;
        } catch {
          return null;
        }
      },
    };
    return { kind: 'ready', cloud };
  } catch (e) {
    const why = reason(e);
    // The SDK throws this precise class when there is no container, and it is
    // not a failure to report as one.
    if (/HostUnavailable|outside .*container|no host/i.test(why)) return { kind: 'nohost' };
    return { kind: 'failed', why };
  }
}

export function cloud(): Promise<Ready> {
  if (!pending) pending = connect();
  return pending;
}

function reason(e: unknown): string {
  const m = (e as Error)?.message ?? String(e ?? '');
  return m.slice(0, 220) || 'no reason given';
}

/**
 * When a file uploaded now stops being retrievable.
 *
 * Computed from the chain's own `RetentionPeriod`, not from a number somebody
 * remembered. It is fourteen days, and every screen that shows a file shows
 * this, because an app called a drive that quietly loses things in a fortnight
 * would be the worst kind of lie: a convenient one.
 */
export const expiresAt = () => Date.now() + RETENTION_MS;
