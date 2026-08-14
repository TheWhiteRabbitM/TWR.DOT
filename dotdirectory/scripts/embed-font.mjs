#!/usr/bin/env node
/**
 * Embed the Unbounded latin subset into src/font/unbounded.css as base64.
 *
 * Unbounded is the official Polkadot typeface — open source, funded by the
 * Polkadot Treasury. It is embedded rather than linked for two reasons: a .dot
 * app is served from Bulletin and has to carry itself, and a webfont that fails
 * to load leaves the page in a fallback nobody announced. That was measured
 * here, not assumed: declaring Unbounded in the stack rendered system-ui,
 * because a canvas measurement of "Unbounded" came out identical to a font name
 * that does not exist.
 *
 * Latin base only. The Cyrillic and Vietnamese ranges are real weight for a page
 * that has no text in them.
 *
 *   node scripts/embed-font.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600&display=swap';

const css = await (await fetch(API, { headers: { 'user-agent': UA } })).text();

// Google emits one @font-face per subset; the latin base is the one whose
// unicode-range starts at U+0000-00FF.
const blocks = [
  ...css.matchAll(
    /font-weight:\s*(\d+);[\s\S]*?src:\s*url\((https:[^)]+\.woff2)\)[^;]*;\s*unicode-range:\s*U\+0000-00FF/g,
  ),
];

if (blocks.length === 0) {
  console.error('no latin subset found — Google may have changed the CSS shape');
  process.exit(1);
}

const header = [
  '/*',
  ' * Unbounded — the official Polkadot typeface, open source and funded by the',
  ' * Polkadot Treasury. Embedded as base64 rather than linked: a .dot app is',
  ' * served from Bulletin and must carry itself, and a webfont that fails to load',
  ' * leaves the page in a fallback nobody announced — which is what was happening',
  ' * here until it was measured. Latin base subset only.',
  ' *',
  ' * Regenerate with: node scripts/embed-font.mjs',
  ' */',
  '',
].join('\n');

let out = header;
for (const [, weight, url] of blocks) {
  const buf = Buffer.from(await (await fetch(url, { headers: { 'user-agent': UA } })).arrayBuffer());
  console.log(`  weight ${weight}: ${Math.round(buf.length / 1024)} kB`);
  out += [
    '',
    '@font-face {',
    '  font-family: Unbounded;',
    '  font-style: normal;',
    `  font-weight: ${weight};`,
    '  font-display: swap;',
    `  src: url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');`,
    '}',
    '',
  ].join('\n');
}

mkdirSync('src/font', { recursive: true });
writeFileSync('src/font/unbounded.css', out);
console.log(`wrote src/font/unbounded.css — ${Math.round(Buffer.byteLength(out) / 1024)} kB`);
