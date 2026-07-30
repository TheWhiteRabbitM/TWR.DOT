/**
 * sync-catalog.mjs — pull the store's shelves from dotmetrics.
 *
 * dot-store has no crawler of its own, on purpose. dotmetrics already indexes
 * the chain hourly, verifies every name against the registry, and captures the
 * screenshots weekly; duplicating that here would mean two directories that
 * could disagree. So this script copies:
 *
 *   dotmetrics/src/lib/discovered.json  ->  src/data/apps.json
 *   dotmetrics/src/lib/shots.json       ->  src/data/shots.json
 *   dotmetrics/public/shots/<l>.webp    ->  public/shots/<l>.webp
 *
 * and bakes one thing in on the way through: `key`, the keccak256 of each label,
 * which is how AppReviews identifies an app. Baking it at build time is what
 * lets the browsing bundle read ratings with plain eth_call and no hashing
 * library at all.
 *
 * Run from the repo root or from dot-store; paths resolve off this file.
 *
 *   node scripts/sync-catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak_256 } from '@noble/hashes/sha3.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(HERE, '..');
const METRICS = path.join(STORE, '..', 'dotmetrics');

const SRC_APPS = path.join(METRICS, 'src', 'lib', 'discovered.json');
const SRC_SHOTS = path.join(METRICS, 'src', 'lib', 'shots.json');
const SRC_SHOT_DIR = path.join(METRICS, 'public', 'shots');
const SRC_CATS = path.join(METRICS, 'src', 'lib', 'categories.json');

const OUT_APPS = path.join(STORE, 'src', 'data', 'apps.json');
const OUT_SHOTS = path.join(STORE, 'src', 'data', 'shots.json');
const OUT_SHOT_DIR = path.join(STORE, 'public', 'shots');

function die(msg) {
  console.error(`sync-catalog FAILED: ${msg}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error::sync-catalog: ${msg}`);
  process.exit(1);
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
};

const hex = (bytes) =>
  '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The AppReviews key for a label: keccak256(bytes(label)). */
const keyFor = (label) => hex(keccak_256(new TextEncoder().encode(label)));

const apps = readJson(SRC_APPS);
if (!apps || typeof apps !== 'object') {
  die(`could not read ${SRC_APPS} — is the dotmetrics indexer checked out beside this app?`);
}

// Refuse to publish an empty shop. A directory that momentarily reads as zero
// names is an upstream glitch, and overwriting a good catalog with it would
// take the whole store down until the next run.
const labels = Object.keys(apps).filter(
  (k) => k !== 'excluded' && apps[k] && typeof apps[k] === 'object',
);
if (labels.length === 0) {
  die(`${SRC_APPS} lists no apps — refusing to overwrite the catalog with an empty one`);
}

// Categories are computed by dotmetrics/indexer/classify.mjs, which reads the
// owner's declaration first and only then falls back to reading their words.
// Folded into the catalog rather than shipped as a second file: a card needs
// its category at render time, and one lookup is one lookup.
const cats = readJson(SRC_CATS) ?? {};

const out = {};
let keyed = 0;
let categorised = 0;
for (const label of labels.sort()) {
  const entry = { ...apps[label] };
  entry.key = keyFor(label);
  const c = cats[label];
  if (c && c.category && c.category !== 'other') {
    entry.category = c.category;
    // Kept so the store can say whether a category was DECLARED by the owner or
    // INFERRED by us. Showing an inference as though it were a fact would be a
    // claim about someone else's app that nobody made.
    entry.categorySource = c.source;
    categorised += 1;
  }
  keyed += 1;
  out[label] = entry;
}
fs.mkdirSync(path.dirname(OUT_APPS), { recursive: true });
fs.writeFileSync(OUT_APPS, JSON.stringify(out, null, 2) + '\n');

// Screenshots. A shot whose file is missing is dropped from the map rather than
// carried as a broken <img>: the store's monogram fallback is the better answer.
const shots = readJson(SRC_SHOTS) ?? {};
fs.mkdirSync(OUT_SHOT_DIR, { recursive: true });

const kept = {};
let copied = 0;
let bytes = 0;
for (const [label, meta] of Object.entries(shots)) {
  if (!meta || typeof meta.file !== 'string') continue;
  const base = path.basename(meta.file);
  const from = path.join(SRC_SHOT_DIR, base);
  if (!fs.existsSync(from)) {
    console.log(`  - ${label}: shots.json points at ${base}, which is not on disk — skipped`);
    continue;
  }
  fs.copyFileSync(from, path.join(OUT_SHOT_DIR, base));
  bytes += fs.statSync(from).size;
  copied += 1;
  kept[label] = meta;
}

// Prune thumbnails that no longer belong to any listed app, so the published
// bundle never accumulates orphans we keep paying storage for.
const keepFiles = new Set(Object.values(kept).map((m) => path.basename(m.file)));
let pruned = 0;
for (const f of fs.readdirSync(OUT_SHOT_DIR)) {
  if (!f.endsWith('.webp')) continue;
  if (!keepFiles.has(f)) {
    fs.rmSync(path.join(OUT_SHOT_DIR, f));
    pruned += 1;
  }
}

const ordered = {};
for (const k of Object.keys(kept).sort()) ordered[k] = kept[k];
fs.writeFileSync(OUT_SHOTS, JSON.stringify(ordered, null, 2) + '\n');

const withShot = Object.keys(ordered).length;
console.log(
  `catalog: ${keyed} apps (all keyed, ${categorised} categorised) · screenshots: ${copied} copied, ${pruned} pruned · ` +
    `${(bytes / 1024).toFixed(0)} KB of artwork`,
);
console.log(
  `${withShot} of ${keyed} apps have a screenshot; the rest fall back to their monogram.`,
);
