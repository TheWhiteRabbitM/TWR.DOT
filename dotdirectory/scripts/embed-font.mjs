#!/usr/bin/env node
/**
 * Embed polkadot.com's actual typefaces into src/font/fonts.css as base64.
 *
 * These are read off the live site, not taken from the brand hub. The hub names
 * Unbounded as "the official font", and an earlier version of this app embedded
 * it — but polkadot.com does not use it anywhere. Measured on the homepage:
 * DM Sans carries the interface (77 elements), DM Serif Display the headings
 * (13, always weight 400), JetBrains Mono the code. Building to the hub instead
 * of the site produced something that used the right palette and still looked
 * like a different product.
 *
 * Embedded rather than linked because a .dot app is served from Bulletin and has
 * to carry itself, and a webfont that fails to load leaves the page in a
 * fallback nobody announced.
 *
 * Latin base subset only, and only the weights actually used.
 *
 *   node scripts/embed-font.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** family → the Google Fonts query for the weights this app actually sets. */
const WANT = [
  ['DM Sans', 'DM+Sans:wght@400;500;700'],
  ['DM Serif Display', 'DM+Serif+Display:ital@0'],
  ['JetBrains Mono', 'JetBrains+Mono:wght@400'],
];

const header = [
  '/*',
  " * polkadot.com's typefaces, embedded.",
  ' *',
  ' * Read off the live site rather than the brand hub: the hub names Unbounded,',
  ' * the site uses DM Sans for the interface, DM Serif Display for headings and',
  ' * JetBrains Mono for data. Base64 rather than linked, because a Bulletin-served',
  ' * page must carry itself and a webfont that fails leaves an unannounced',
  ' * fallback. Latin base subset, only the weights this app sets.',
  ' *',
  ' * Regenerate with: node scripts/embed-font.mjs',
  ' */',
  '',
].join('\n');

let out = header;
let total = 0;

for (const [family, query] of WANT) {
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=swap`, {
      headers: { 'user-agent': UA },
    })
  ).text();

  // One @font-face per subset; the latin base is the range starting U+0000-00FF.
  const blocks = [
    ...css.matchAll(
      /font-weight:\s*(\d+);[\s\S]*?src:\s*url\((https:[^)]+\.woff2)\)[^;]*;\s*unicode-range:\s*U\+0000-00FF/g,
    ),
  ];

  if (blocks.length === 0) {
    console.error(`${family}: no latin subset found — Google may have changed the CSS shape`);
    process.exit(1);
  }

  for (const [, weight, url] of blocks) {
    const buf = Buffer.from(
      await (await fetch(url, { headers: { 'user-agent': UA } })).arrayBuffer(),
    );
    total += buf.length;
    console.log(`  ${family} ${weight}: ${Math.round(buf.length / 1024)} kB`);
    out += [
      '',
      '@font-face {',
      `  font-family: '${family}';`,
      '  font-style: normal;',
      `  font-weight: ${weight};`,
      '  font-display: swap;',
      `  src: url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');`,
      '}',
      '',
    ].join('\n');
  }
}

mkdirSync('src/font', { recursive: true });
writeFileSync('src/font/fonts.css', out);
console.log(
  `wrote src/font/fonts.css — ${Math.round(Buffer.byteLength(out) / 1024)} kB (${Math.round(total / 1024)} kB of font)`,
);
