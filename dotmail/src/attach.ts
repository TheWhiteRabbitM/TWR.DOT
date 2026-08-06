/**
 * attach.ts — pictures on a letter, given a 16 kB ceiling per envelope.
 *
 * WHY AN ATTACHMENT CANNOT SIMPLY GO IN THE LETTER
 *   One envelope holds 16 kB, and every byte is a storage deposit paid by the
 *   sender. A photograph is not 16 kB. So a picture is shrunk hard, split into
 *   parts, and each part is sent as its OWN envelope sealed to the same people;
 *   the letter carries only a reference. Reassembly happens in the reader.
 *
 * THE COST IS REAL AND IS SHOWN BEFORE SENDING
 *   Five parts is five transactions and five deposits. A mail client that hides
 *   that until the wallet asks five times has lied by omission, so the composer
 *   states the count and the total before anything is signed.
 *
 * PARTS ARE INVISIBLE AS LETTERS
 *   A part is sealed exactly like a letter, so the recipient finds it with the
 *   same scan, but its payload says `kind: 'part'` and the inbox sets it aside
 *   rather than showing an inbox full of fragments.
 *
 * WHAT IS STILL LEAKED
 *   Size. An observer counts envelopes and learns roughly how big the thing
 *   was, though not what it is or who it went to. Padding every letter to a
 *   fixed number of parts would fix that and would cost everybody the size of
 *   the largest attachment anybody ever sends, which is not a trade worth
 *   making by default.
 */

/** Bytes of image data per envelope. Under the 16 kB contract ceiling with
 *  room for the seal overhead, the base64 inflation and the JSON around it. */
export const PART_BYTES = 9_000;

/** Hard cap on a shrunk picture. Four parts of a beach at 1024px wide is about
 *  this, and beyond it the deposits stop being a rounding error. */
export const MAX_IMAGE_BYTES = 90_000;

export const MAX_DIM = 1280;

export type Attachment = {
  name: string;
  type: string;
  size: number;
  /** Ties the parts to the letter. Random, client-side, so it can be chosen
   *  before any envelope id exists. */
  group: string;
  parts: number;
};

export type Part = {
  kind: 'part';
  group: string;
  i: number;
  total: number;
  /** base64 of this slice. */
  data: string;
};

/** A picture, shrunk until it is worth sending. Returns WebP bytes.
 *
 *  Tries progressively harder rather than guessing a quality once: the same
 *  1280px frame is 30 kB of sky and 300 kB of foliage, so a fixed setting is
 *  either wasteful or a refusal depending on the photograph. */
export async function shrink(file: File): Promise<{ bytes: Uint8Array; type: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser will not give us a canvas');

  for (const [w, q] of [[width, 0.82], [width, 0.68], [Math.round(width * 0.75), 0.62],
                        [Math.round(width * 0.55), 0.55], [Math.round(width * 0.4), 0.5]] as const) {
    const h = Math.round((height / width) * w);
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', q));
    if (!blob) continue;
    if (blob.size <= MAX_IMAGE_BYTES) {
      bitmap.close?.();
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp', width: w, height: h };
    }
  }
  bitmap.close?.();
  throw new Error('that picture will not shrink small enough to send');
}

const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Random enough that two people attaching at the same second cannot collide. */
export function newGroup(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Cut into envelope-sized pieces. */
export function split(bytes: Uint8Array, group: string): Part[] {
  const total = Math.max(1, Math.ceil(bytes.length / PART_BYTES));
  const parts: Part[] = [];
  for (let i = 0; i < total; i++) {
    parts.push({
      kind: 'part', group, i, total,
      data: b64(bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES)),
    });
  }
  return parts;
}

/** Put one back together. `null` when a piece is missing, which is a real
 *  outcome: a send can land four parts of five, and half a photograph
 *  presented as a photograph would be worse than saying so. */
export function join(parts: Part[]): Uint8Array | null {
  if (!parts.length) return null;
  const total = parts[0].total;
  const seen = new Map<number, Part>();
  for (const p of parts) if (p.total === total) seen.set(p.i, p);
  if (seen.size !== total) return null;

  const chunks: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const p = seen.get(i);
    if (!p) return null;
    chunks.push(unb64(p.data));
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** A data: URL for display. Built from the joined bytes, never from anything
 *  the network handed us. */
export const dataUrl = (bytes: Uint8Array, type: string) =>
  `data:${type};base64,${b64(bytes)}`;

export const humanSize = (n: number) =>
  n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1000).toFixed(0)} kB` : `${(n / 1e6).toFixed(1)} MB`;
