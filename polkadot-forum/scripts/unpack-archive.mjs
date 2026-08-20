/**
 * Restore the archive packed by `pack-archive.mjs` into public/ before a build.
 * Silent no-op when the pack is missing (a fresh import wrote the files already)
 * or when public/ already holds them, so it is safe to run every time.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(root, 'archive', 'forum-archive.json.gz');
const pub = join(root, 'public');

if (!existsSync(pack)) {
  console.log('no packed archive; run `npm run import` to fetch one');
  process.exit(0);
}
if (existsSync(join(pub, 'forum-index.json'))) {
  console.log('archive already present in public/');
  process.exit(0);
}
mkdirSync(pub, { recursive: true });
const bundle = JSON.parse(gunzipSync(readFileSync(pack)).toString());
for (const [name, data] of Object.entries(bundle)) writeFileSync(join(pub, name), JSON.stringify(data));
console.log(`unpacked ${Object.keys(bundle).length} files into public/`);
