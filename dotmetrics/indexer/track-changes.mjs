/**
 * Two facts about each name that only a DIFF between runs can produce: how often
 * its bundle has been republished (VELOCITY), and a running log of what changed
 * across the whole directory (CHANGELOG).
 *
 * Runs after enrich-onchain.mjs (so every contenthash is current) and after
 * probe-liveness.mjs (so the CONFIRMED liveness state and its transitions are
 * fresh). It reads apps.json and the previous snapshot kept in state.json, then:
 *
 *   VELOCITY — writes two fields per name back into apps.json (and thence, via
 *   the refresh's copy step, into src/lib/discovered.json):
 *     updateCount           how many times a NON-EMPTY contenthash has changed to
 *                           another non-empty contenthash since we first saw it.
 *                           The first contenthash a name ever gets is its BIRTH,
 *                           not an update, and withdrawing one is not an update
 *                           either — only a real republish counts.
 *     contenthashChangedAt  unix seconds of the last such change. We learn of the
 *                           change by diffing snapshots, not from a block, so this
 *                           is stamped at run time — the honest "when we first saw
 *                           it different", never a fabricated block time.
 *
 *   CHANGELOG — appends to src/lib/changelog.json, newest first, capped at
 *   {@link CAP}. Four kinds, each derived by diffing this run against the stored
 *   snapshot:
 *     new          a name present now that was not in the snapshot. Stamped at
 *                  its real `firstSeenAt` (a fact), not at diff time.
 *     updated      a non-empty contenthash changed to another non-empty one.
 *     unreachable  a name whose CONFIRMED liveness went alive/unknown → dead.
 *     revived      a name whose CONFIRMED liveness went dead → alive.
 *
 * WHY THE LIVENESS SIGNAL IS THE CONFIRMED STATE, NOT THE RAW PROBE. A changelog
 * that emitted "unreachable" from a single probe would spew a wave of them every
 * time one gateway had a bad minute. Instead the diff reads state.liveness.state,
 * which probe-liveness only advances a label into `unreachable` after two
 * consecutive runs and never as part of a wave (see liveness-history.mjs). So the
 * mass-outage guard is already paid for upstream. A second, belt-and-suspenders
 * check applies {@link waveThreshold} here too: if one diff would somehow still
 * yield more unreachable entries than that, they are dropped as a correlated
 * failure and the run warns — an index never records a die-off it cannot believe.
 *
 *   node track-changes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveThreshold } from './liveness-history.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'apps.json');
const STATE = path.join(HERE, 'state.json');
const CHANGELOG = path.join(HERE, '..', 'src', 'lib', 'changelog.json');

/** Newest changelog entries kept. Older ones age out — the series keeps history. */
const CAP = 200;

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/** Loud in both a terminal and a GitHub Actions summary. */
function warn(message) {
  console.error(`\n!!! ${message}\n`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${message}`);
}

const now = Math.floor(Date.now() / 1000);

const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const excluded = Array.isArray(file.excluded) ? [...file.excluded] : [];
const labels = Object.keys(file).filter((k) => k !== 'excluded').sort();

const state = readJson(STATE, {});
const prevNames = state.changes?.names ?? {};
const bootstrapped = Boolean(state.changes?.bootstrapped);

// The CONFIRMED liveness view (already guarded upstream), plus WHEN each label
// last flipped, read from the transition log so a changelog entry can be stamped
// with the moment it happened rather than the moment we noticed.
const confirmed = state.liveness?.state ?? {};
const transitions = Array.isArray(state.liveness?.transitions) ? state.liveness.transitions : [];
const deadSinceOf = new Map();
const revivedAtOf = new Map();
for (const t of transitions) {
  if (!t || typeof t.at !== 'number') continue;
  if (t.to === 'unreachable') deadSinceOf.set(t.label, t.at);
  if (t.to === 'alive') revivedAtOf.set(t.label, t.at);
}
const liveOf = (label) => confirmed[label] ?? 'unknown';

// ---- VELOCITY: fold each name's contenthash history forward -----------------
const nextSnapshot = {};
let births = 0;
let republished = 0;
for (const label of labels) {
  const entry = file[label];
  const curCH = String(entry.contenthash ?? '');
  const prev = prevNames[label];

  let updateCount;
  let changedAt; // undefined = never changed since first seen

  if (!prev) {
    // First time this name is tracked: its current contenthash (if any) is a
    // birth, not an update.
    updateCount = 0;
    changedAt = undefined;
    if (curCH) births += 1;
  } else {
    const prevCH = String(prev.contenthash ?? '');
    updateCount = Number.isInteger(prev.updateCount) ? prev.updateCount : 0;
    changedAt = typeof prev.changedAt === 'number' ? prev.changedAt : undefined;
    if (curCH !== prevCH && curCH && prevCH) {
      // A real republish: non-empty → different non-empty. THIS is an update.
      updateCount += 1;
      changedAt = now;
      republished += 1;
    }
    // prevCH empty → curCH set (a birth), or curCH empty (a withdrawal): neither
    // is an update, so the count and the last-changed time are left untouched.
  }

  entry.updateCount = updateCount;
  if (typeof changedAt === 'number') entry.contenthashChangedAt = changedAt;
  else delete entry.contenthashChangedAt;

  nextSnapshot[label] = {
    contenthash: curCH,
    updateCount,
    ...(typeof changedAt === 'number' ? { changedAt } : {}),
    live: liveOf(label),
  };
}

// ---- CHANGELOG: diff this run against the stored snapshot -------------------
const fresh = [];
const unreachableCandidates = [];
const displayNameOf = (label) =>
  typeof file[label]?.displayName === 'string' ? file[label].displayName : undefined;

const entryFor = (kind, label, at) => {
  const e = { at, kind, label };
  const dn = displayNameOf(label);
  if (dn) e.displayName = dn;
  return e;
};

if (!bootstrapped) {
  // First-ever run: we did not witness these registrations happen, so we do not
  // pretend to have — but each name's firstSeenAt IS a real timestamp, so the
  // changelog is seeded from those, newest first. Nothing is invented.
  for (const label of labels) {
    const at = typeof file[label].firstSeenAt === 'number' ? file[label].firstSeenAt : now;
    fresh.push(entryFor('new', label, at));
  }
} else {
  for (const label of labels) {
    const prev = prevNames[label];
    if (!prev) {
      // Genuinely new since the last run.
      const at = typeof file[label].firstSeenAt === 'number' ? file[label].firstSeenAt : now;
      fresh.push(entryFor('new', label, at));
      continue;
    }
    const prevCH = String(prev.contenthash ?? '');
    const curCH = String(file[label].contenthash ?? '');
    if (curCH !== prevCH && curCH && prevCH) {
      fresh.push(entryFor('updated', label, now));
    }
    const prevLive = prev.live ?? 'unknown';
    const curLive = liveOf(label);
    if (prevLive !== 'unreachable' && curLive === 'unreachable') {
      unreachableCandidates.push(entryFor('unreachable', label, deadSinceOf.get(label) ?? now));
    }
    if (prevLive === 'unreachable' && curLive === 'alive') {
      fresh.push(entryFor('revived', label, revivedAtOf.get(label) ?? now));
    }
  }
}

// Belt-and-suspenders wave guard, reusing the liveness threshold. The confirmed
// state should never hand us a wave — but if it did, we would rather log nothing
// than a die-off no honest process can believe from one gateway.
const threshold = waveThreshold(Object.keys(confirmed).length || labels.length);
let heldWave = false;
if (unreachableCandidates.length > threshold) {
  heldWave = true;
  warn(
    `changelog withheld ${unreachableCandidates.length} 'unreachable' entries in one diff — over the ` +
      `wave threshold of ${threshold}. Confirmed liveness should never yield a wave, so this reads as a ` +
      `correlated failure and is NOT recorded as ${unreachableCandidates.length} deaths.`,
  );
} else {
  fresh.push(...unreachableCandidates);
}

// Newest first, capped. Existing entries are already ordered; a stable sort by
// `at` keeps insertion order among equal timestamps.
const existing = Array.isArray(readJson(CHANGELOG, [])) ? readJson(CHANGELOG, []) : [];
const combined = [...fresh, ...existing]
  .map((e, i) => [e, i])
  .sort((a, b) => (b[0].at ?? 0) - (a[0].at ?? 0) || a[1] - b[1])
  .map(([e]) => e)
  .slice(0, CAP);

fs.writeFileSync(CHANGELOG, JSON.stringify(combined) + '\n');

// ---- persist apps.json (velocity fields) and the new snapshot ---------------
const out = {};
for (const label of labels) out[label] = file[label];
out.excluded = excluded.sort();
fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');

// Re-read state at write time and spread over it: several scripts keep
// bookkeeping in state.json and none of it may be dropped by this write.
fs.writeFileSync(
  STATE,
  JSON.stringify(
    {
      ...readJson(STATE, {}),
      changes: { updatedAt: new Date(now * 1000).toISOString(), bootstrapped: true, names: nextSnapshot },
    },
    null,
    2,
  ) + '\n',
);

const kinds = fresh.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
console.log(
  `velocity: ${republished} contenthash republish${republished === 1 ? '' : 'es'} this run · ` +
    `${births} first-seen bundles · ${labels.length} names tracked`,
);
console.log(
  `changelog: +${fresh.length} entr${fresh.length === 1 ? 'y' : 'ies'} ` +
    `(${['new', 'updated', 'unreachable', 'revived'].map((k) => `${kinds[k] ?? 0} ${k}`).join(', ')})` +
    `${heldWave ? ' · a wave was withheld' : ''} · ${combined.length}/${CAP} kept`,
);
console.log(`wrote ${FILE}\n      ${STATE}\n      ${CHANGELOG}`);
