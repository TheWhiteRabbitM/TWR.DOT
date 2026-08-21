/**
 * Linkable ring signatures, in the browser.
 *
 * The whole scheme is arithmetic on bn254 G1, so there is nothing to download,
 * no proving key, no ceremony and no wasm: a few hundred lines of BigInt. The
 * contract verifies exactly this, with the same hash-to-curve and the same
 * challenge chain, because a signer and a verifier that disagree about a byte
 * are two programs that will never agree about anything.
 *
 * What it gives you: a proof that you hold one of the private keys in a set,
 * without saying which, plus a key image that is identical every time you sign
 * with that key and reveals nothing about which key it is. One person, one vote,
 * secret ballot.
 */

export const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const Q = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export type Pt = readonly [bigint, bigint];
export const G: Pt = [1n, 2n];
export const ZERO: Pt = [0n, 0n];

const mod = (a: bigint, m = P) => ((a % m) + m) % m;

function inv(a: bigint, m = P): bigint {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

export const isZero = (p: Pt) => p[0] === 0n && p[1] === 0n;

export function add(a: Pt, b: Pt): Pt {
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  if (a[0] === b[0] && mod(a[1] + b[1]) === 0n) return ZERO;
  const l =
    a[0] === b[0] && a[1] === b[1]
      ? mod(3n * mod(a[0] * a[0]) * inv(2n * a[1]))
      : mod((b[1] - a[1]) * inv(b[0] - a[0]));
  const x = mod(l * l - a[0] - b[0]);
  return [x, mod(l * (a[0] - x) - a[1])];
}

export function mul(p: Pt, k: bigint): Pt {
  let n = mod(k, Q);
  let acc: Pt = ZERO;
  let base: Pt = p;
  while (n > 0n) {
    if (n & 1n) acc = add(acc, base);
    base = add(base, base);
    n >>= 1n;
  }
  return acc;
}

export const onCurve = (p: Pt) => mod(p[1] * p[1]) === mod(mod(p[0] * p[0]) * p[0] + 3n);

/* --------------------------------------------------------------- hashing -- */

const enc = new TextEncoder();

function bytes32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** keccak256, taken from ethers so the browser and the contract agree exactly. */
type Keccak = (data: Uint8Array) => string;
let keccak: Keccak | null = null;
export function useKeccak(fn: Keccak) {
  keccak = fn;
}
function h(data: Uint8Array): bigint {
  if (!keccak) throw new Error('keccak not provided');
  return BigInt(keccak(data));
}

/** The same try-and-increment the contract uses. */
export function hashToPoint(pk: Pt): Pt {
  let x = mod(h(cat(enc.encode('bLSAG:H2C:bn254'), bytes32(pk[0]), bytes32(pk[1]))));
  for (let i = 0; i < 256; i += 1) {
    const y2 = mod(mod(mod(x * x) * x) + 3n);
    const y = powmod(y2, (P + 1n) / 4n);
    if (mod(y * y) === y2) return [x, y];
    x = mod(x + 1n);
  }
  throw new Error('no point found');
}

function powmod(b: bigint, e: bigint, m = P): bigint {
  let r = 1n;
  let base = mod(b, m);
  let ex = e;
  while (ex > 0n) {
    if (ex & 1n) r = mod(r * base, m);
    base = mod(base * base, m);
    ex >>= 1n;
  }
  return r;
}

const challenge = (message: bigint, L: Pt, R: Pt) =>
  h(cat(bytes32(message), bytes32(L[0]), bytes32(L[1]), bytes32(R[0]), bytes32(R[1]))) % Q;

/* ------------------------------------------------------------- signature -- */

export interface Signature {
  c0: bigint;
  s: bigint[];
  keyImage: Pt;
}

export const publicKey = (secret: bigint): Pt => mul(G, secret);
export const keyImageOf = (secret: bigint, pub: Pt): Pt => mul(hashToPoint(pub), secret);

function randomScalar(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return mod(v, Q) || 1n;
}

/**
 * Sign as member `index` of `ring`.
 *
 * The signer starts the chain of challenges at their own position with a random
 * commitment, walks it all the way round through values they invent, and closes
 * it at the start using the one thing only they can compute. A verifier walking
 * the same circle cannot tell where it was begun.
 */
export function sign(message: bigint, ring: Pt[], index: number, secret: bigint): Signature {
  const n = ring.length;
  const image = keyImageOf(secret, ring[index]);
  const s: bigint[] = new Array(n).fill(0n);
  const c: bigint[] = new Array(n).fill(0n);

  const alpha = randomScalar();
  c[(index + 1) % n] = challenge(message, mul(G, alpha), mul(hashToPoint(ring[index]), alpha));

  for (let k = 1; k < n; k += 1) {
    const i = (index + k) % n;
    s[i] = randomScalar();
    const L = add(mul(G, s[i]), mul(ring[i], c[i]));
    const R = add(mul(hashToPoint(ring[i]), s[i]), mul(image, c[i]));
    c[(i + 1) % n] = challenge(message, L, R);
  }

  s[index] = mod(alpha - mod(c[index] * secret, Q), Q);
  return { c0: c[0], s, keyImage: image };
}

/** The same check the contract makes, so a client can refuse before paying. */
export function verify(message: bigint, ring: Pt[], sig: Signature): boolean {
  let c = sig.c0;
  for (let i = 0; i < ring.length; i += 1) {
    const L = add(mul(G, sig.s[i]), mul(ring[i], c));
    const R = add(mul(hashToPoint(ring[i]), sig.s[i]), mul(sig.keyImage, c));
    c = challenge(message, L, R);
  }
  return c === sig.c0;
}
