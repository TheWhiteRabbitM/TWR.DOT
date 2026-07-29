/**
 * The gate on SITE publishes: republish dotmetrics.dot only when the app
 * itself changed.
 *
 * The hourly refresh used to build and pad-publish the site every run, mostly
 * to carry a fresh data snapshot — but the directory now reaches the page
 * through the `directory` record (see src/lib/directory.ts), so an unchanged
 * app republished hourly was pure transaction burn. Weekly retention renewal
 * is keepalive.yml's job; this file's job is detecting a real change.
 *
 * The hash covers what a build is made from: everything under src/, plus
 * index.html, public/, package.json and vite.config.ts. Three exclusions, and
 * one normalisation, each because the refresh itself rewrites the bytes:
 *
 *   - src/lib/discovered.json, ecosystem.json, history.json, liveness.json,
 *     changelog.json are DATA the hourly job writes, and public/feed.json +
 *     public/feed.xml are the static feed rebuilt every refresh; counting any of
 *     them would republish the site every hour and the gate would gate nothing.
 *     They still SHIP — Vite bakes them into dist on the next publish that a real
 *     app change triggers — they just never trigger one themselves.
 *   - the DIRECTORY_CID literal in src/lib/directory.ts is masked before
 *     hashing: it is re-pinned whenever a directory upload happens, and a
 *     moved pin is the record's business, not an app change. Any OTHER edit to
 *     directory.ts still counts.
 *
 * A content hash rather than `git write-tree`, deliberately: the hourly job
 * commits those data files, so every commit would change the subtree hash of
 * src/ and the literal git tree could never match twice — and the sed'd pin
 * exists only in the working tree, which a HEAD tree hash would not see.
 *
 *   node app-tree-hash.mjs check     decision (+ $GITHUB_OUTPUT in Actions)
 *   node app-tree-hash.mjs commit    record the published hash in state.json
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const STATE = path.join(HERE, 'state.json');

const INCLUDE = ['src', 'index.html', 'public', 'package.json', 'vite.config.ts'];
const EXCLUDE = new Set([
  'src/lib/discovered.json',
  'src/lib/ecosystem.json',
  'src/lib/history.json',
  'src/lib/liveness.json',
  'src/lib/changelog.json',
  'public/feed.json',
  'public/feed.xml',
]);

/** Every included file, as sorted app-relative POSIX paths. */
function collect(rel, out) {
  const abs = path.join(APP, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) collect(`${rel}/${name}`, out);
  } else if (!EXCLUDE.has(rel)) {
    out.push(rel);
  }
}

export function appTreeHash() {
  const files = [];
  for (const rel of INCLUDE) collect(rel, files);
  files.sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    let body = fs.readFileSync(path.join(APP, rel));
    if (rel === 'src/lib/directory.ts') {
      body = Buffer.from(
        body
          .toString('utf8')
          .replace(
            /export const DIRECTORY_CID = '[a-z0-9]*'/,
            "export const DIRECTORY_CID = '<pin>'",
          ),
      );
    }
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
const hash = appTreeHash();

if (command === 'check') {
  const last = state.sitePublish ?? {};
  let publish = true;
  let reason;
  if (!last.treeHash) {
    reason = 'no site publish on record yet';
  } else if (hash !== last.treeHash) {
    reason = `app source changed (was ${last.treeHash.slice(0, 12)}…, is ${hash.slice(0, 12)}…)`;
  } else {
    publish = false;
    reason =
      `app source unchanged since the publish of ${last.publishedAt ?? '?'} ` +
      `(hash ${hash.slice(0, 12)}…) — skipping build and publish; ` +
      `keepalive.yml owns the weekly retention renewal`;
  }
  console.log(`app tree hash: ${hash}`);
  console.log(publish ? `PUBLISH — ${reason}` : `SKIP — ${reason}`);
  githubOutput({ publish, hash, reason });
} else if (command === 'commit') {
  state.sitePublish = { treeHash: hash, publishedAt: new Date().toISOString() };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log(`recorded site publish (hash ${hash.slice(0, 12)}…) → ${STATE}`);
} else {
  console.error('usage: node app-tree-hash.mjs check | commit');
  process.exit(1);
}
