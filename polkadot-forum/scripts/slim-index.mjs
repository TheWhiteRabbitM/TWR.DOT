/**
 * Build a SLIM home index so the first paint downloads ~200 KB instead of the
 * full ~1.8 MB topic list. The home only shows the most recent topics plus the
 * category cards and the tag cloud, so it needs the newest slice, not all 3,588
 * topics. The full list is still shipped as forum-index.json and loaded in the
 * background (chain.ts loadFullIndex) to fill in category browsing and search.
 *
 *   node scripts/slim-index.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const RECENT = 500;

const full = JSON.parse(readFileSync(join(pub, 'forum-index.json'), 'utf8'));
const topics = [...(full.topics ?? [])].sort(
  (a, b) => +new Date(b.lastPostedAt || b.createdAt || 0) - +new Date(a.lastPostedAt || a.createdAt || 0),
);
const slim = {
  categories: full.categories ?? [],
  generatedAt: full.generatedAt,
  source: full.source,
  slim: true,
  topics: topics.slice(0, RECENT),
};
writeFileSync(join(pub, 'forum-home.json'), JSON.stringify(slim));

const kb = (n) => Math.round(n / 1024);
console.log(
  `forum-home.json: ${slim.topics.length}/${topics.length} topics, ` +
    `${kb(JSON.stringify(slim).length)} KB (full is ${kb(JSON.stringify(full).length)} KB)`,
);
