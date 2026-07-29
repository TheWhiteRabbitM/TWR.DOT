/**
 * Bundle liveness: is the contenthash each name points at actually still being
 * served? Bulletin retention is a ~14-day window, so a directory that lists an
 * app whose bundle has evaporated is lying by omission.
 *
 * Runs after enrich-onchain.mjs and reads/writes the same apps.json in place,
 * writing three fields per probed name:
 *
 *   alive              did the gateway serve the bundle this run? (bool)
 *   lastSeenAliveAt    unix seconds of the last probe that found it reachable —
 *                      carried across runs, so "unreachable for N days" is
 *                      computable. Never written on a failed probe.
 *   livenessCheckedAt  unix seconds of the probe, COARSE (UTC day) on purpose:
 *                      a per-second timestamp would change the file every hour
 *                      and defeat publish-directory's stable digest.
 *
 * WHAT ONE PROBE CAN AND CANNOT PROVE. Everything goes through ONE gateway.
 * "Unreachable" means that gateway did not serve the bundle when asked —
 * evidence about one door to the network, never proof the data is gone from it.
 * Two guards enforce that reading:
 *
 *   1. MASS-DEATH GUARD: if more than half of the bundles seen alive last run
 *      flip to unreachable in a single run, that is evidence the GATEWAY
 *      failed, not the apps. Previous state is kept untouched, nothing is
 *      recorded, and the run warns loudly. An index must never publish "the
 *      ecosystem died" because one endpoint had a bad minute.
 *   2. CANARIES: dotmetrics and italiarovente are published by our own
 *      pipeline, which verifies every publish on-chain. If the probe says THEY
 *      are dead, the probe is wrong — same treatment as the mass-death guard.
 *
 * Names with no contenthash are not probed: there is nothing to probe, and an
 * unknown must never be written as a measured failure.
 *
 * WHAT THIS RUN LEAVES BEHIND BESIDES apps.json. The three fields above are a
 * SNAPSHOT, and a snapshot of something with a ~14-day shelf life is worth
 * little later. The series is the valuable part, so a healthy run also writes:
 *
 *   state.json  → `liveness`: the CONFIRMED per-app state, the deaths awaiting
 *                 confirmation, and the transition log (who went down or came
 *                 back, and when).
 *   liveness.jsonl / ../src/lib/liveness.json
 *               → one ecosystem point per UTC day: alive out of deployed.
 *
 * The confirmed series is deliberately more cautious than `entry.alive`, which
 * is this run's raw verdict: see indexer/liveness-history.mjs for the two rules
 * that keep a sick gateway from being written into permanent history as a wave
 * of deaths. Both guards below run FIRST, so a discarded run records no
 * transitions and no day point either — no measurement, no row.
 *
 *   node probe-liveness.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accumulate, upsertDay } from './liveness-history.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'apps.json');
const STATE = path.join(HERE, 'state.json');
/** Append-style ledger, one row per UTC day. Committed by the scheduled job. */
const LEDGER = path.join(HERE, 'liveness.jsonl');
/**
 * The same rows as a JSON array for the app to import. Rewritten from the WHOLE
 * ledger every run, so it is a derived file: losing it loses nothing.
 */
const APP_COPY = path.join(HERE, '..', 'src', 'lib', 'liveness.json');

const GATEWAY =
  process.env.LIVENESS_GATEWAY ?? 'https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/';
const TIMEOUT_MS = Number(process.env.LIVENESS_TIMEOUT_MS ?? 10_000);
/** Sequential with spacing, deliberately: this is a probe, not a load test. */
const SPACING_MS = 150;

/** Names our own publish pipeline keeps alive and verifies on-chain. */
const CANARIES = ['dotmetrics', 'italiarovente'];

/** Only text-form CIDv1 is probeable; enrich-onchain leaves non-ipfs-ns records as hex. */
const CID_RE = /^baf[a-z0-9]{50,}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One bundle, one verdict. HEAD first; if the gateway misbehaves on HEAD
 * (405/501, a 5xx, or a thrown request), a GET for the first byte decides.
 * A clean 404/410 is an ANSWER — the gateway looked and does not have it.
 */
async function probe(cid) {
  for (const method of ['HEAD', 'GET']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GATEWAY + cid, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: method === 'GET' ? { range: 'bytes=0-0' } : undefined,
      });
      if (res.ok || res.status === 206) {
        // Drop the byte we asked for; keeping bodies open leaks sockets.
        if (method === 'GET') await res.body?.cancel().catch(() => {});
        return true;
      }
      if (res.status === 404 || res.status === 410) return false;
      if (method === 'GET') return false;
      // HEAD answered something odd (405/501/5xx): let GET decide.
    } catch {
      if (method === 'GET') return false;
      // HEAD itself failed (timeout, reset): let GET decide.
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

/** Loud in both a terminal and a GitHub Actions summary. */
function warn(message) {
  console.error(`\n!!! ${message}\n`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${message}`);
}

const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const labels = Object.keys(file).filter((k) => k !== 'excluded');
const probeable = labels.filter((l) => CID_RE.test(String(file[l].contenthash ?? '')));
const previouslyAlive = probeable.filter((l) => file[l].alive === true);

console.log(
  `probing ${probeable.length} contenthashes through ${GATEWAY} ` +
    `(${labels.length - probeable.length} names have nothing to probe)`,
);

const result = new Map();
for (const label of probeable) {
  const up = await probe(file[label].contenthash);
  result.set(label, up);
  console.log(`  ${up ? '·' : '!'} ${label.padEnd(28)} ${up ? 'alive' : 'UNREACHABLE'}`);
  await sleep(SPACING_MS);
}

const flipped = previouslyAlive.filter((l) => result.get(l) === false);
const deadCanaries = CANARIES.filter((l) => result.get(l) === false);
const unreachable = probeable.filter((l) => result.get(l) === false);

// ---- the two honesty guards: on either, keep every previous state ----------
if (deadCanaries.length > 0) {
  warn(
    `liveness probe discarded: canary ${deadCanaries.map((l) => `${l}.dot`).join(', ')} ` +
      `probed unreachable while the publish pipeline verifies it on-chain — that is the ` +
      `gateway failing, not the apps. Previous liveness state kept, nothing recorded.`,
  );
  process.exit(0);
}
if (previouslyAlive.length > 0 && flipped.length * 2 > previouslyAlive.length) {
  warn(
    `liveness probe discarded: ${flipped.length} of ${previouslyAlive.length} previously-alive ` +
      `bundles flipped to unreachable in ONE run — that is evidence the gateway failed, not ` +
      `that the ecosystem died. Previous liveness state kept, nothing recorded.`,
  );
  process.exit(0);
}

// ---- record --------------------------------------------------------------
const now = Math.floor(Date.now() / 1000);
const dayCoarse = now - (now % 86400);

let newlyDown = 0;
let recovered = 0;
for (const label of labels) {
  const entry = file[label];
  if (!result.has(label)) {
    // Nothing to probe (no contenthash, or a non-CID record): no liveness claim
    // may stand on this entry. Stale fields from a contenthash that has since
    // been withdrawn are removed rather than left asserting something.
    delete entry.alive;
    delete entry.lastSeenAliveAt;
    delete entry.livenessCheckedAt;
    continue;
  }
  const up = result.get(label);
  if (up && entry.alive === false) recovered += 1;
  if (!up && entry.alive === true) newlyDown += 1;
  entry.alive = up;
  if (up) entry.lastSeenAliveAt = now;
  entry.livenessCheckedAt = dayCoarse;
}

fs.writeFileSync(FILE, JSON.stringify(file, null, 2) + '\n');

// ---- the series ----------------------------------------------------------
// Reached only past both guards, so every row below rests on a run this script
// was willing to believe.
const readJson = (file_, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file_, 'utf8'));
  } catch {
    return fallback;
  }
};

const { liveness, point, changes } = accumulate({
  previous: readJson(STATE, {}).liveness,
  probe: result,
  now,
  gateway: new URL(GATEWAY).host,
});

// Re-read state.json at write time and spread over it: index-apps.mjs,
// directory-digest.mjs and app-tree-hash.mjs all keep bookkeeping in the same
// file, and none of it may be dropped by this write.
fs.writeFileSync(STATE, JSON.stringify({ ...readJson(STATE, {}), liveness }, null, 2) + '\n');

const previousRows = fs.existsSync(LEDGER)
  ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
  : [];
const rows = upsertDay(previousRows, point);
fs.writeFileSync(LEDGER, rows.join('\n') + '\n');
fs.writeFileSync(APP_COPY, JSON.stringify(rows.map((r) => JSON.parse(r))) + '\n');

for (const label of changes.died) {
  console.log(`  transition: ${label}.dot alive -> unreachable (confirmed over ${liveness.confirmRuns} runs)`);
}
for (const label of changes.recovered) {
  console.log(`  transition: ${label}.dot unreachable -> alive`);
}
if (changes.pending.length > 0) {
  console.log(
    `awaiting confirmation (unreachable once, not yet believed dead): ` +
      `${changes.pending.map((l) => `${l}.dot`).join(' · ')}`,
  );
}
if (changes.heldAsWave.length > 0) {
  warn(
    `${changes.heldAsWave.length} bundles would have been confirmed dead in ONE run, over the ` +
      `limit of ${changes.threshold} — apps do not expire together, so this reads as a gateway ` +
      `or network failure and NOT as ${changes.heldAsWave.length} deaths. None were recorded; ` +
      `they stay pending with their original timestamps and will be recorded, unchanged, the ` +
      `first run that does not look like a wave.`,
  );
}

console.log(
  `\nprobed ${probeable.length} · alive ${probeable.length - unreachable.length} · ` +
    `unreachable ${unreachable.length}` +
    `${newlyDown ? ` (+${newlyDown} newly down)` : ''}` +
    `${recovered ? ` (${recovered} recovered)` : ''} · guard: not tripped`,
);
if (unreachable.length > 0) {
  console.log(`unreachable: ${unreachable.map((l) => `${l}.dot`).join(' · ')}`);
}
console.log(
  `day ${point.day}: ${point.alive} of ${point.deployed} deployed bundles served ` +
    `(${point.unconfirmed} unconfirmed) via ${point.gateway}`,
);
console.log(`wrote ${FILE}\n      ${STATE}\n      ${LEDGER}\n      ${APP_COPY}`);
