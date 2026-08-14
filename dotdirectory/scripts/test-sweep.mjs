/**
 * Does the candidate generator actually reach the names we know it missed?
 *
 * `polkashoot` is the test that matters: registered, deployed, self-described,
 * and invisible to both the block-scanning indexer and the affix-only version of
 * this generator. A discovery mechanism that cannot reach a name we have in
 * front of us is not one, and asserting otherwise from the shape of the code is
 * how the first sweep shipped reporting "namespace swept" having swept nothing.
 *
 * Runs the generator over many seeds, because a single seed proves only that
 * one slice happened to contain it.
 */
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

// The generator is pure and worth testing without a browser, but it lives in a
// TypeScript file that imports ethers. So the types are stripped by esbuild —
// the same tool vite already uses — rather than by hand-rolled regexes, which
// is how the first attempt turned `const out: string[]` into `const out[]`.
const src = readFileSync(new URL('../src/sweep.ts', import.meta.url), 'utf8');
const slice = src.slice(src.indexOf('const WORDS'), src.indexOf('export interface Found'));
const { code } = await transform(slice.replace(/^export /gm, ''), { loader: 'ts' });

const candidates = new Function(`${code}\nreturn candidates;`)();

const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ['polkashoot'];
const known = new Set(['dotmail', 'dotmetrics', 'thebutton', 'peoplebook']);

const SEEDS = 40;
const hitCount = Object.fromEntries(TARGETS.map((t) => [t, 0]));
let size = 0;
for (let i = 0; i < SEEDS; i++) {
  const seed = 12_000_000 + i * 137;
  const list = candidates(known, seed);
  size = list.length;
  for (const t of TARGETS) if (list.includes(t)) hitCount[t]++;
}

console.log(`${size} candidates per visit, ${SEEDS} seeds tested\n`);
let bad = 0;
for (const t of TARGETS) {
  const pct = Math.round((hitCount[t] / SEEDS) * 100);
  console.log(`  ${t.padEnd(16)} reached in ${hitCount[t]}/${SEEDS} visits (${pct}%)`);
  if (!hitCount[t]) bad++;
}
process.exit(bad ? 1 : 0);
