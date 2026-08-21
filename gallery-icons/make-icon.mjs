/**
 * Gallery icons, drawn in code.
 *
 * The existing icons were made by hand, which is fine until a nineteenth app
 * ships and nobody remembers the corner radius. These are the same shape —
 * 512px squircle, diagonal gradient, one white glyph — described as signed
 * distance fields and rasterised here, with no image library involved: node's
 * zlib is enough to write a PNG, and an SDF gives clean edges without
 * supersampling.
 *
 *   node make-icon.mjs            # writes every icon defined below
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 512;
const RADIUS = 108;

/* ------------------------------------------------------------------ png --- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ sdf --- */
const len = (x, y) => Math.hypot(x, y);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Rounded rectangle centred at (cx,cy), half-extents (hw,hh), corner r. */
const sdRound = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => len(px - cx, py - cy) - r;
/** Segment with round caps, from a to b, half-thickness t. */
const sdSeg = (px, py, ax, ay, bx, by, t) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return len(pax - bax * h, pay - bay * h) - t;
};
/** Convex triangle through three points. */
const sdTri = (px, py, p) => {
  let d = Infinity, s = 1;
  for (let i = 0; i < 3; i++) {
    const a = p[i], b = p[(i + 1) % 3];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const wx = px - a[0], wy = py - a[1];
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    d = Math.min(d, len(wx - ex * h, wy - ey * h));
    const c1 = py >= a[1], c2 = py < b[1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * d;
};

/** Coverage of an SDF at one pixel: a one-pixel-wide smooth edge. */
const cov = (d) => clamp(0.5 - d, 0, 1);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* ----------------------------------------------------------------- draw --- */
function render({ from, to, glyph }) {
  const c0 = hex(from), c1 = hex(to);
  const out = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      const outside = sdRound(px, py, S / 2, S / 2, S / 2, S / 2, RADIUS);
      const a = cov(outside);
      if (a <= 0) continue;
      // diagonal gradient, top-left light to bottom-right deep
      const t = clamp((px + py) / (2 * S), 0, 1);
      let r = c0[0] + (c1[0] - c0[0]) * t;
      let g = c0[1] + (c1[1] - c0[1]) * t;
      let b = c0[2] + (c1[2] - c0[2]) * t;
      const w = glyph(px, py); // 0..1 coverage of the white mark
      if (w > 0) {
        r += (250 - r) * w;
        g += (250 - g) * w;
        b += (250 - b) * w;
      }
      const i = (y * S + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = Math.round(a * 255);
    }
  }
  return png(out, S);
}

/* ---------------------------------------------------------------- icons --- */

/** polkadot-forum: two speech bubbles, one behind the other. A forum is more
 *  than one voice, and the gap between them is the background showing through
 *  rather than a drawn line, so it stays clean at gallery size. */
function forumGlyph(px, py) {
  const bubble = (cx, cy, hw, hh, tail) => {
    const body = sdRound(px, py, cx, cy, hw, hh, 34);
    const t = sdTri(px, py, tail);
    return Math.min(body, t);
  };
  // the bubble behind has no tail: two tails read as clutter at gallery size,
  // and one is enough to say speech.
  const back = sdRound(px, py, 214, 196, 118, 84, 34);
  const front = bubble(300, 300, 118, 84, [[236, 366], [300, 366], [252, 424]]);
  const cFront = cov(front);
  const cBack = cov(back) * (1 - cov(front - 16));
  return Math.max(cFront, cBack);
}

/** aidetector: a magnifier over three lines of text. Reads as inspection of
 *  writing rather than of anything else, which is the whole app. */
function aiGlyph(px, py) {
  const line = (y, x0, x1) => sdSeg(px, py, x0, y, x1, y, 17);
  const text = Math.min(line(178, 118, 394), line(248, 118, 330), line(318, 118, 300));
  const lensR = 96, lensC = [318, 316];
  const ring = Math.abs(sdCircle(px, py, lensC[0], lensC[1], lensR)) - 22;
  const handle = sdSeg(px, py, 386, 384, 434, 432, 22);
  const glass = Math.min(ring, handle);
  // the text stops short of the lens instead of running under it
  const cut = 1 - cov(Math.min(sdCircle(px, py, lensC[0], lensC[1], lensR + 18), handle - 18));
  return Math.max(cov(text) * cut, cov(glass));
}


/** dotdirectory: an index. Rows of different length with a marker beside each,
 *  which is what a list of names looks like before it looks like anything else. */
function directoryGlyph(px, py) {
  const rows = [
    [150, 400, 150],
    [150, 356, 226],
    [150, 312, 302],
    [150, 268, 378],
  ];
  let d = Infinity;
  for (const [x0, x1, y] of rows) {
    d = Math.min(d, sdSeg(px, py, x0 + 66, y, x1, y, 19));
    d = Math.min(d, sdRound(px, py, x0 - 8, y, 19, 19, 6));
  }
  return cov(d);
}

/** blockchoir: four voices at four heights, which is a chord drawn as blocks and
 *  a step sequencer drawn as music. Same shape either way, which is the app. */
function choirGlyph(px, py) {
  const bars = [
    [140, 300, 118],
    [222, 256, 202],
    [304, 330, 148],
    [386, 214, 244],
  ];
  let d = Infinity;
  for (const [x, top, h] of bars) d = Math.min(d, sdRound(px, py, x, top + h / 2, 30, h / 2, 26));
  return cov(d);
}


/** secretballot: the ring, with a tick inside it. The ring is what hides you,
 *  the tick is what you are still able to say. */
function ballotGlyph(px, py) {
  let d = Infinity;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    d = Math.min(d, sdCircle(px, py, 256 + Math.cos(a) * 150, 256 + Math.sin(a) * 150, 19));
  }
  const tick = Math.min(sdSeg(px, py, 214, 258, 246, 292, 20), sdSeg(px, py, 246, 292, 306, 216, 20));
  return cov(Math.min(d, tick));
}

/** whenwemeet: a calendar with one square filled. Everyone knows the shape, and
 *  the filled cell is the answer the question was asked for. */
function meetGlyph(px, py) {
  const frame = Math.abs(sdRound(px, py, 256, 268, 150, 132, 26)) - 17;
  const bar = sdSeg(px, py, 120, 196, 392, 196, 9);
  const peg = Math.min(sdRound(px, py, 190, 128, 15, 26, 12), sdRound(px, py, 322, 128, 15, 26, 12));
  let cells = Infinity;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const on = r === 1 && c === 1;
      const x = 178 + c * 78, y = 258 + r * 76;
      cells = Math.min(cells, on ? sdRound(px, py, x, y, 30, 26, 9) : sdCircle(px, py, x, y, 11));
    }
  return cov(Math.min(frame, bar, peg, cells));
}

/** stillhere: a pulse that stops. The line runs, spikes, and flattens, which is
 *  the whole arrangement in one stroke. */
function pulseGlyph(px, py) {
  const p = [[96, 268], [176, 268], [212, 186], [258, 348], [300, 268], [416, 268]];
  let d = Infinity;
  for (let i = 0; i < p.length - 1; i++) d = Math.min(d, sdSeg(px, py, p[i][0], p[i][1], p[i+1][0], p[i+1][1], 19));
  return cov(d);
}

/** whopays: one round bill, cut. Two lines from the centre are all it takes to
 *  say a shared thing being divided. */
function payGlyph(px, py) {
  const ring = Math.abs(sdCircle(px, py, 256, 256, 148)) - 19;
  const cut1 = sdSeg(px, py, 256, 256, 256, 108, 15);
  const cut2 = sdSeg(px, py, 256, 256, 384, 330, 15);
  return cov(Math.min(ring, cut1, cut2));
}

const ICONS = [
  { name: 'secretballot', from: '#ff7aa8', to: '#a3003f', glyph: ballotGlyph },
  { name: 'whenwemeet', from: '#ffcc70', to: '#a35a08', glyph: meetGlyph },
  { name: 'stillhere', from: '#7ee8d6', to: '#0d5f6b', glyph: pulseGlyph },
  { name: 'whopays', from: '#9ae6a0', to: '#1a6b3c', glyph: payGlyph },
  { name: 'dotdirectory', from: '#ffc266', to: '#b45309', glyph: directoryGlyph },
  { name: 'blockchoir', from: '#67e8f9', to: '#0e5f8a', glyph: choirGlyph },
  { name: 'polkadot-forum', from: '#ff4d8d', to: '#b3004f', glyph: forumGlyph },
  { name: 'aidetector', from: '#a78bfa', to: '#4c1d95', glyph: aiGlyph },
];

for (const icon of ICONS) {
  const buf = render(icon);
  writeFileSync(new URL(`${icon.name}.png`, import.meta.url), buf);
  console.log(`${icon.name}.png  ${S}x${S}  ${(buf.length / 1024).toFixed(1)} KB`);
}
