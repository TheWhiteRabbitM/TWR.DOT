import { APP_REVIEWS, DEVNET_EVM_RPC } from './config';

/**
 * Live reads from the deployed AppReviews contract, with no dependencies: a
 * hand-rolled JSON-RPC `eth_call` and 4-byte selectors computed at build time.
 * The store talks to its own contract on every load — the ratings you see are
 * what the chain says, not a cached number.
 *
 * There is deliberately no keccak in this bundle. The only keys the store ever
 * asks about are the apps it lists, and those keys are baked into the catalog
 * data at build time (see scripts that write `key` into src/data/apps.json).
 */

// keccak-derived at build time — the signature is in the comment beside each.
const SEL = {
  appCount: '0xb55ca2c3', // appCount()
  minStatus: '0x12d29a0c', // minStatus()
  app: '0x785d6e18', // app(bytes32)
  reviewCount: '0x2891e4ce', // reviewCount(bytes32)
  reviews: '0x55be16b5', // reviews(bytes32,uint256,uint256)
  me: '0xbc1915b4', // me(address,bytes32)
  review: '0xb92d73c0', // review(string,string,uint8,string)
} as const;

/** The write selector, exported for whoever gets to sign a real transaction. */
export const REVIEW_SELECTOR = SEL.review;

const TIMEOUT_MS = 9000;

async function ethCall(data: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DEVNET_EVM_RPC, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: APP_REVIEWS, data }, 'latest'],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: string };
    return typeof j.result === 'string' && j.result.length > 2 ? j.result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------ ABI decoding */

const WORD = 64;
const word = (hex: string, i: number) => hex.slice(2 + i * WORD, 2 + (i + 1) * WORD);
const num = (w: string) => Number(BigInt('0x' + w));
const big = (w: string) => BigInt('0x' + w);

/** A dynamic `string` at `offsetBytes` from the start of the payload area. */
function str(hex: string, offsetBytes: number): string {
  const at = offsetBytes * 2 + 2;
  const len = Number(BigInt('0x' + hex.slice(at, at + WORD)));
  if (!len) return '';
  const bytes = hex.slice(at + WORD, at + WORD + len * 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(out);
}

const pad = (v: string) => v.replace(/^0x/, '').padStart(WORD, '0');
const u = (n: number | bigint) => pad(BigInt(n).toString(16));

/* ---------------------------------------------------------------- reads */

/** How many distinct apps have at least one review. */
export async function appCount(): Promise<number | null> {
  const r = await ethCall(SEL.appCount);
  return r ? num(word(r, 0)) : null;
}

/** The personhood tier the contract currently requires (0 = open). */
export async function minStatus(): Promise<number | null> {
  const r = await ethCall(SEL.minStatus);
  return r ? num(word(r, 0)) : null;
}

export interface Rating {
  /** Sum of all ratings, and how many — the average is sum/count. */
  sum: number;
  count: number;
  firstAt: number;
}

/**
 * An app's aggregate rating, or null when it has never been reviewed (the
 * contract reverts on an unknown app, which `eth_call` returns as no result —
 * "no reviews yet", not an error to surface).
 */
export async function ratingOf(key: string): Promise<Rating | null> {
  const r = await ethCall(SEL.app + pad(key));
  if (!r) return null;
  // App { string label; string name; uint32 sum; uint32 count; uint64 firstAt }
  //
  // The struct is DYNAMIC — it carries two strings — so a function returning it
  // does not start with the struct. It starts with an offset TO the struct, and
  // the head follows one word later:
  //
  //   word 0  offset to the tuple (0x20)
  //   word 1  offset to `label`
  //   word 2  offset to `name`
  //   word 3  sum
  //   word 4  count
  //   word 5  firstAt
  //
  // Reading from word 2 — as this did — returns the offset to `name` as the sum
  // and the real sum as the count. With one review that produced "44.8 out of 5
  // from 5 ratings": 224 (0xe0, an offset) divided by 5. Verified against the
  // live contract's raw returndata rather than reasoned about a second time.
  return { sum: num(word(r, 3)), count: num(word(r, 4)), firstAt: num(word(r, 5)) };
}

export interface Review {
  author: string;
  rating: number;
  /** 0 = unverified (a wallet), 1 = Lite, 2 = Full — a verified human. */
  status: number;
  at: number;
  body: string;
}

/** A page of an app's reviews, oldest-first. Empty on any failure. */
export async function reviewsOf(key: string, offset = 0, limit = 20): Promise<Review[]> {
  const r = await ethCall(SEL.reviews + pad(key) + u(offset) + u(limit));
  if (!r) return [];
  try {
    // Outer: [ptr array] -> [len][ptr elem0][ptr elem1]...
    const arrAt = num(word(r, 0));
    const base = arrAt; // byte offset of the array header
    const len = num(word(r, base / 32));
    const out: Review[] = [];
    for (let i = 0; i < len; i++) {
      // element pointers are relative to the first element slot
      const elemPtr = num(word(r, base / 32 + 1 + i));
      const e = base + 32 + elemPtr; // byte offset of this struct's head
      const h = e / 32;
      out.push({
        author: '0x' + word(r, h),
        rating: num(word(r, h + 1)),
        status: num(word(r, h + 2)),
        at: num(word(r, h + 3)),
        body: str(r, e + num(word(r, h + 4))),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export interface Me {
  status: number;
  required: number;
  author: string;
  yourRating: number;
}

/** What this account is, and whether it already reviewed this app. */
export async function meAt(account: string, key: string): Promise<Me | null> {
  const r = await ethCall(SEL.me + pad(account) + pad(key));
  if (!r) return null;
  return {
    status: num(word(r, 0)),
    required: num(word(r, 1)),
    author: '0x' + word(r, 2),
    yourRating: num(word(r, 3)),
  };
}

/**
 * Calldata for posting a review, ready for whatever can sign it. Built here so
 * the encoding lives next to the decoding it mirrors.
 */
export function encodeReview(label: string, name: string, rating: number, body: string): string {
  const enc = new TextEncoder();
  const dyn = (s: string) => {
    const b = enc.encode(s);
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const padded = hex.padEnd(Math.ceil(hex.length / WORD) * WORD, '0');
    return u(b.length) + padded;
  };
  // Head: [ptr label][ptr name][rating][ptr body] — 4 words before the payload.
  const head = 4 * 32;
  const labelHex = dyn(label);
  const nameHex = dyn(name);
  const labelLen = labelHex.length / 2;
  const nameLen = nameHex.length / 2;
  return (
    SEL.review +
    u(head) +
    u(head + labelLen) +
    u(rating) +
    u(head + labelLen + nameLen) +
    labelHex +
    nameHex +
    dyn(body)
  );
}

export { big };
