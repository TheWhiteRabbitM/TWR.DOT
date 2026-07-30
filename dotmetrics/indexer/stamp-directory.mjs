/**
 * stamp-directory.mjs — write the directory's own generation time into it.
 *
 * WHY THE PAGE NEEDED THIS
 *   The dashboard reads its app list live, from the `directory` text record, but
 *   dated itself from ecosystem.json — which is imported statically and so is
 *   frozen at the last SITE publish. The site only republishes when its source
 *   changes, correctly, to spare transactions. So the two drifted apart: the
 *   hero showed 79 apps read minutes ago beside "updated 11h ago" read off the
 *   bundle. Both true, of different things, and together they read as a broken
 *   pipeline.
 *
 *   A timestamp carried inside the data cannot drift away from it.
 *
 * WHY IT CANNOT COST A TRANSACTION
 *   directory-digest.mjs decides whether to upload by hashing the SEMANTIC
 *   content of indexer/apps.json — per-name fields, never timestamps. This
 *   stamps the COPY at src/lib/discovered.json, which the digest never reads. An
 *   unchanged directory therefore still hashes the same, still skips its upload,
 *   and still costs nothing.
 *
 * WHY IT IS A FILE AND NOT A `node -e` IN THE WORKFLOW
 *   It was, briefly, and the newline in `JSON.stringify(…) + "\n"` terminated
 *   the YAML block and broke the whole workflow. Caught by validating the YAML
 *   rather than by a failed run at 17 past the hour.
 *
 *   node stamp-directory.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'src', 'lib', 'discovered.json');

let dir;
try {
  dir = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`stamp-directory FAILED: could not read ${FILE}: ${e?.message ?? e}`);
  process.exit(1);
}
if (!dir || typeof dir !== 'object') {
  console.error('stamp-directory FAILED: the directory is not an object');
  process.exit(1);
}

dir.generatedAt = Math.floor(Date.now() / 1000);
fs.writeFileSync(FILE, JSON.stringify(dir, null, 2) + '\n');

const apps = Object.keys(dir).filter(
  (k) => k !== 'excluded' && k !== 'generatedAt' && dir[k] && typeof dir[k] === 'object',
).length;
console.log(
  `directory stamped ${new Date(dir.generatedAt * 1000).toISOString()} · ${apps} apps`,
);
