/**
 * verify-store-meta.mjs — read back, from the chain, the records our
 * publication guidelines require of every app: manifest, category,
 * screenshots. A set that cannot be read back did not happen, whatever the
 * CLI printed — the rule the refresh pipeline already lives by.
 *
 *   node indexer/verify-store-meta.mjs
 */
import { contracts, nodeOf } from './dotns.mjs';

const LABELS = [
  'thebutton', 'openpetition', 'dotmetrics', 'wudcommunity', 'italiarovente',
  'truereviews', 'dot-store', 'chirponchain', 'peoplewiki', 'ethonchain', 'dotmailbox',
  'arcadeonchain', 'peoplebook', 'gameboyonchain', 'nesonchain',
];

const { resolver } = contracts();
let bad = 0;

console.log('label               manifest  category     shots');
for (const label of LABELS) {
  const node = nodeOf(`${label}.dot`);
  const read = async (key) => {
    try { return String((await resolver.text(node, key)) ?? ''); }
    catch { return null; }                  // could not read ≠ reads as empty
  };
  const [manifest, category, shots] = await Promise.all([
    read('manifest'), read('category'), read('screenshots'),
  ]);
  let name = '';
  try { name = JSON.parse(manifest || '{}').displayName ?? ''; } catch { /* not JSON */ }
  const nShots = (shots ?? '').split(/[\s,]+/).filter(Boolean).length;
  const ok = Boolean(name) && Boolean(category) && nShots > 0;
  if (!ok) bad++;
  console.log(
    label.padEnd(20)
    + (name ? 'y' : manifest === null ? '?' : '-').padEnd(10)
    + String(category ?? '?').padEnd(13)
    + String(nShots || '-')
    + (ok ? '' : '   <-- INCOMPLETE'),
  );
}

console.log(bad ? `\n${bad} apps incomplete` : '\nall apps meet the guidelines');
process.exit(bad ? 1 : 0);
