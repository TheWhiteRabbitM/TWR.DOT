/**
 * Enrich the directory with what each .dot name actually says about itself
 * on-chain: owner, manifest, contenthash, executable record, contract address.
 *
 * Runs after index-apps.mjs (which decides what EXISTS) and reads the same
 * apps.json in place, so the ordinary refresh keeps every field current.
 *
 * All five reads go over the plain public JSON-RPC and every one of them is
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
 * Tier from chain facts alone — facts ANY name can satisfy.
 *
 * There used to be a tier above these: "live data", awarded to the four labels
 * whose contract ABI dotmetrics had hand-coded a reader for. Every one of those
 * apps belongs to the person running this index, so the top of a public ranking
 * was reachable only by its operator. Worse, it was not a fact about the app at
 * all — it was a fact about OUR code, wearing the same badge as facts about the
 * chain. It is gone. What dotmetrics reads directly is still read, but it is
 * labelled as our instrumentation and it does not rank anything.
 */
function tierOf({ manifest, contenthash }) {
  if (manifest) return 0; // published: a readable manifest
  if (contenthash) return 1; // deployed: a bundle, but nothing describing it
  return 2; // name only
}

/**
 * A `contract` text record, if the name declares one.
 *
 * This is dotmetrics' OWN CONVENTION, not a platform standard: the manifest has
 * no field for a contract address (DEVFEEDBACK finding 8), and without one no
 * per-app number can be attributed to a name. So we read a record beside the
 * manifest, on the same content resolver:
 *
 *   dotns text set <name>.dot contract 0xYourContract --env devnet
 *
 * Stored LOWERCASED, deliberately: measure-activity.mjs lowercases the addresses
 * it reads out of `revive.ContractEmitted`, and the two only join if both sides
 * normalise the same way. A checksummed string would silently never match.
 * Anything that is not exactly 20 hex bytes is not an address and is discarded —
 * we would rather show nothing than look up a number under a typo.
 */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function contractOf(text) {
  const value = String(text ?? '').trim();
  return ADDRESS_RE.test(value) ? value.toLowerCase() : '';
}

/**
 * A `screenshots` text record: artwork the app's OWNER supplied.
 *
 * Second convention of ours, same shape as `contract`, and the reason it works
 * is that the registry already enforces ownership — a write to a name you do
 * not own is rejected with an explicit owner check. So the key that holds the
 * name IS the authorisation, and dot-store needs no accounts, no uploads and no
 * "prove this app is yours" flow:
 *
 *   dotns text set <name>.dot screenshots bafy...,bafy... --env devnet
 *
 * Comma-separated Bulletin CIDs, in the order they should be shown. Up to
 * MAX_SHOTS_DECLARED of them, so one record can never make the store fetch an
 * unbounded number of images.
 *
 * Two honesty constraints ride along, both enforced in the store rather than
 * here. First, owner-supplied artwork is LABELLED as such: we cannot review
 * submissions the way an app store does, so a reader has to be able to tell who
 * made the picture. Second, Bulletin retention is about 14 days — an owner who
 * stops republishing loses the CID, so the store falls back to its own capture
 * and then to the monogram. A missing CID is expected, not an error.
 *
 * Only the CID shape is validated. We are not fetching them here: the indexer's
 * job is to report what the chain says, and a CID that no longer resolves is a
 * fact the store discovers at render time.
 */
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;
const MAX_SHOTS_DECLARED = 6;
function screenshotsOf(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => CID_RE.test(s))
    .slice(0, MAX_SHOTS_DECLARED);
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
let declared = 0;
let ownerArt = 0;
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

  // Read on its own, same rule as every other record: an answer overwrites
  // (a withdrawn declaration must disappear), a failure changes nothing.
  try {
    set('contract', contractOf(await resolver.text(node, 'contract')));
  } catch {
    /* read failed: keep whatever the last successful run recorded */
  }

  // A `category` the owner declared. Third convention of ours, same shape as
  // the others, and the one that matters most for fairness: everything else in
  // the store's categorisation is us reading their words and guessing. This is
  // them telling us, and it always wins.
  //
  //   dotns text set <name>.dot category games --env devnet
  //
  // Not validated against a list here on purpose — the indexer reports what the
  // chain says, and the store decides whether it recognises the value. A typo
  // should look like a typo, not vanish silently at the indexing step.
  try {
    const declared = String((await resolver.text(node, 'category')) ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 24);
    if (declared) next.category = declared;
    else delete next.category;
  } catch {
    /* read failed: keep whatever the last successful run recorded */
  }

  // Owner-supplied artwork, same read-or-keep rule. An empty answer removes the
  // declaration, so an owner can take their screenshots down again.
  try {
    const declaredShots = screenshotsOf(await resolver.text(node, 'screenshots'));
    if (declaredShots.length) next.screenshots = declaredShots;
    else delete next.screenshots;
  } catch {
    /* read failed: keep whatever the last successful run recorded */
  }

  try {
    next.hasExecutable = Boolean(await resolver.text(nodeOf(`app.${label}.dot`), 'executable'));
  } catch {
    next.hasExecutable = next.hasExecutable ?? false;
  }

  // Tier reflects the merged entry, so a failed read can never demote an app
  // that is still published.
  next.tier = tierOf({
    manifest: next.displayName || next.description,
    contenthash: next.contenthash,
  });

  file[label] = next;
  enriched += 1;
  if (next.displayName || next.description) manifests += 1;
  if (next.contenthash) contenthashes += 1;
  if (next.hasExecutable) executables += 1;
  if (next.contract) declared += 1;
  if (next.screenshots?.length) ownerArt += 1;
});

const out = {};
for (const label of Object.keys(file)) out[label] = file[label];
out.excluded = excluded.sort();
fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');

const owners = new Set(Object.values(file).map((a) => a.owner).filter(Boolean));
// published / deployed / name only — three tiers now, not four.
const byTier = [0, 1, 2].map((t) => Object.values(file).filter((a) => a.tier === t).length);
console.log(
  `enriched ${enriched}/${labels.length} names · ${manifests} manifests · ${contenthashes} contenthashes · ` +
    `${executables} executables · ${declared} contract records · ${ownerArt} owner screenshots · ` +
    `${owners.size} distinct owners · ` +
    `tiers ${byTier.join('/')} · ` +
    `${excluded.length} excluded${unowned ? ` (+${unowned} newly unowned)` : ''}` +
    `${failures ? ` · ${failures} owner reads failed` : ''}`,
);
