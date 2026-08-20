/**
 * Pack the imported archive into one gzipped file for the repository.
 *
 * The archive is 47 MB of JSON across 65 files, which is too much to commit and
 * too slow (and too rude) to re-import from Discourse on every scheduled
 * republish. Packed it is about a quarter of that, and `unpack-archive.mjs`
 * restores it byte-for-byte before a build, so CI produces the same bundle as a
 * local build and `pad` can renew it incrementally.
 *
 *   node scripts/pack-archive.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const out = join(root, 'archive');
mkdirSync(out, { recursive: true });

const files = ['forum-index.json', ...readdirSync(pub).filter((f) => /^t-\d\d\.json$/.test(f)).sort()];
const bundle = {};
for (const f of files) bundle[f] = JSON.parse(readFileSync(join(pub, f), 'utf8'));

const raw = Buffer.from(JSON.stringify(bundle));
const packed = gzipSync(raw, { level: 9 });
writeFileSync(join(out, 'forum-archive.json.gz'), packed);

const mb = (n) => (n / 1e6).toFixed(1);
console.log(`packed ${files.length} files: ${mb(raw.length)}MB -> ${mb(packed.length)}MB`);
