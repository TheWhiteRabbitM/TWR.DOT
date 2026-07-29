/**
 * The gate on dot-store publishes: republish dot-store.dot only when something
 * a visitor would actually see has changed.
 *
 * The store's catalog is regenerated hourly from dotmetrics, and most hours it
 * comes back byte-identical. Publishing anyway would burn Bulletin transactions
 * out of a finite quota to ship an identical bundle — so the hour is priced by
 * content, not by the clock.
 *
 * Unlike dotmetrics, the store has no mutable data record: the catalog and the
 * screenshots are baked into the bundle, so a catalog change IS a site change
 * and there is nothing to exclude. Everything a build is made from counts:
 * src/, index.html, public/, package.json, vite.config.ts.
 *
 * A content hash rather than `git write-tree`, for the same reason dotmetrics
 * uses one: the job commits regenerated data files, so the git subtree hash
 * would differ on every run and the gate would gate nothing.
 *
 *   node scripts/tree-hash.mjs check     decision (+ $GITHUB_OUTPUT in Actions)
 *   node scripts/tree-hash.mjs commit    record the published hash in state.json
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const STATE = path.join(HERE, 'state.json');

const INCLUDE = ['src', 'index.html', 'public', 'package.json', 'vite.config.ts'];

/** Every included file, as sorted app-relative POSIX paths. */
function collect(rel, out) {
  const abs = path.join(APP, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) collect(`${rel}/${name}`, out);
  } else {
    out.push(rel);
  }
}

export function storeTreeHash() {
  const files = [];
  for (const rel of INCLUDE) collect(rel, files);
  files.sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    const body = fs.readFileSync(path.join(APP, rel));
    h.update(`${rel}\n${body.length}\n`);
    h.update(body);
  }
  return h.digest('hex');
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function githubOutput(pairs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, lines + '\n');
}

const [command] = process.argv.slice(2);
const state = readJson(STATE, {});
const hash = storeTreeHash();

if (command === 'check') {
  const last = state.sitePublish ?? {};
  let publish = true;
  let reason;
  if (!last.treeHash) {
    reason = 'no store publish on record yet';
  } else if (hash !== last.treeHash) {
    reason = `store content changed (was ${last.treeHash.slice(0, 12)}…, is ${hash.slice(0, 12)}…)`;
  } else {
    publish = false;
    reason =
      `store content unchanged since the publish of ${last.publishedAt ?? '?'} ` +
      `(hash ${hash.slice(0, 12)}…) — skipping build and publish; ` +
      `keepalive.yml owns the weekly retention renewal`;
  }
  console.log(`store tree hash: ${hash}`);
  console.log(publish ? `PUBLISH — ${reason}` : `SKIP — ${reason}`);
  githubOutput({ publish, hash, reason });
} else if (command === 'commit') {
  state.sitePublish = { treeHash: hash, publishedAt: new Date().toISOString() };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log(`recorded store publish (hash ${hash.slice(0, 12)}…) → ${STATE}`);
} else {
  console.error('usage: node scripts/tree-hash.mjs check | commit');
  process.exit(1);
}
