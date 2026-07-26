/**
 * Enrich the directory with what each .dot name actually says about itself
 * on-chain: owner, manifest, contenthash, executable record.
 *
 * Runs after index-apps.mjs (which decides what EXISTS) and reads the same
 * apps.json in place, so the ordinary refresh keeps every field current.
 *
 * All four reads go over the plain public JSON-RPC and every one of them is
 * independent: a name whose manifest is missing still gets its contenthash, a
 * name whose contenthash call fails still gets its manifest. Nothing here is
 * inferred — a field is present only when the chain returned it.
 *
 * Records are read DIRECTLY from the content resolver. registry.resolver(node)
 * returns a dead resolver on this devnet and reverts; see indexer/dotns.mjs.
 *
 *   node enrich-onchain.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contracts, nodeOf, ownerOf, contenthashToCid, mapLimit } from './dotns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'apps.json');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);

/**
 * Labels dotmetrics can read live contract metrics for (tier 0). Mirrors the
 * READERS map in src/lib/registry.ts — buildApps() re-checks against the real
 * map, so an entry that drifts out of sync degrades to its chain tier rather
 * than lying.
 */
const READER_LABELS = new Set(['openpetition', 'truereviews', 'discreetly', 'thebutton']);

/** Tier from chain facts alone. Lower is more substantial. */
function tierOf({ label, manifest, contenthash }) {
  if (READER_LABELS.has(label)) return 0; // live data: we have a contract reader
  if (manifest) return 1; // published: a readable manifest
  if (contenthash) return 2; // deployed: a bundle, but nothing describing it
  return 3; // name only
}

const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const excluded = Array.isArray(file.excluded) ? [...file.excluded] : [];
delete file.excluded;

const labels = Object.keys(file);
const { resolver } = contracts();

let enriched = 0;
let manifests = 0;
let contenthashes = 0;
let executables = 0;
let unowned = 0;
let failures = 0;

await mapLimit(labels, CONCURRENCY, async (label) => {
  const entry = file[label];
  const node = nodeOf(`${label}.dot`);

  // An owner READ that succeeded and came back zero means the name is not
  // registered. An owner read that FAILED means nothing — never drop an app
  // because one HTTP request went wrong.
  let owner = '';
  let ownerKnown = false;
  try {
    owner = await ownerOf(label);
    ownerKnown = true;
  } catch {
    failures += 1;
  }

  if (ownerKnown && !owner) {
    delete file[label];
    if (!excluded.includes(label)) excluded.push(label);
    unowned += 1;
    console.log(`  ! ${label}.dot has no owner — moved to excluded`);
    return;
  }

  // Each record is read on its own, and each read is either an ANSWER or a
  // FAILURE. An answer overwrites the field, empty answers included — a
  // manifest that was withdrawn must disappear. A failure leaves the field
  // exactly as the last successful run left it: a timed-out request is not the
  // same statement as "this name has nothing".
  const next = { ...entry };
  if (owner) next.owner = owner;

  const set = (key, value) => {
    if (value) next[key] = value;
    else delete next[key];
  };

  let manifest = null;
  try {
    const text = await resolver.text(node, 'manifest');
    // A record that is present but not JSON is a manifest we cannot read, and
    // that is an answer: the fields go.
    try {
      if (text) manifest = JSON.parse(text);
    } catch {
      manifest = null;
    }
    set('displayName', typeof manifest?.displayName === 'string' ? manifest.displayName : '');
    set('description', typeof manifest?.description === 'string' ? manifest.description : '');
    set('iconCid', typeof manifest?.icon?.cid === 'string' ? manifest.icon.cid : '');
  } catch {
    /* read failed: keep the manifest fields already on the entry */
  }

  try {
    set('contenthash', contenthashToCid(await resolver.contenthash(node)));
  } catch {
    /* read failed: keep the contenthash already on the entry */
  }

  try {
    next.hasExecutable = Boolean(await resolver.text(nodeOf(`app.${label}.dot`), 'executable'));
  } catch {
    next.hasExecutable = next.hasExecutable ?? false;
  }

  // Tier reflects the merged entry, so a failed read can never demote an app
  // that is still published.
  next.tier = tierOf({
    label,
    manifest: next.displayName || next.description,
    contenthash: next.contenthash,
  });

  file[label] = next;
  enriched += 1;
  if (next.displayName || next.description) manifests += 1;
  if (next.contenthash) contenthashes += 1;
  if (next.hasExecutable) executables += 1;
});

const out = {};
for (const label of Object.keys(file)) out[label] = file[label];
out.excluded = excluded.sort();
fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');

const owners = new Set(Object.values(file).map((a) => a.owner).filter(Boolean));
const byTier = [0, 1, 2, 3].map((t) => Object.values(file).filter((a) => a.tier === t).length);
console.log(
  `enriched ${enriched}/${labels.length} names · ${manifests} manifests · ${contenthashes} contenthashes · ` +
    `${executables} executables · ${owners.size} distinct owners · tiers ${byTier.join('/')} · ` +
    `${excluded.length} excluded${unowned ? ` (+${unowned} newly unowned)` : ''}` +
    `${failures ? ` · ${failures} owner reads failed` : ''}`,
);
