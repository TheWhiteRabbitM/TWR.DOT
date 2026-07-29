/**
 * Turning one-shot liveness probes into a series that is worth keeping.
 *
 * WHY THIS EXISTS. Bulletin retention is a ~14-day window, so "is this bundle
 * served right now" is a fact with a two-week shelf life. What does not expire
 * is how that answer CHANGED: when a bundle stopped being served, when it came
 * back, and how many of the ecosystem's bundles were up on a given day. This
 * module is the accumulator for both — a pure function, so the rules below can
 * be tested against invented outages instead of waiting for a real one.
 *
 * THE HARD PART IS NOT COUNTING, IT IS NOT LYING. Every probe goes through ONE
 * gateway. A negative answer is evidence about one door to the network, never
 * proof the data is gone, and gateways have bad hours. probe-liveness.mjs
 * already refuses a whole run when its canaries die or when more than half the
 * previously-alive bundles flip at once. Those guards catch a gateway falling
 * over. They do not catch a gateway that is merely *unwell* — dropping a
 * quarter of requests for an hour — and that is exactly the shape that would
 * write a wave of deaths into a permanent series. So two more rules apply here,
 * and only here, to the series:
 *
 *   1. A DEATH MUST BE SEEN TWICE. `alive → unreachable` enters the series only
 *      after {@link CONFIRM_RUNS} CONSECUTIVE runs say so. One bad minute
 *      therefore records nothing at all. A RECOVERY is recorded on the first
 *      sighting, because a bundle that was actually served is positive proof and
 *      needs no second opinion — the asymmetry is deliberate.
 *   2. DEATHS DO NOT COME IN WAVES. Independent apps do not expire together. If
 *      one run would confirm more than {@link waveThreshold} deaths at once,
 *      that is a correlated failure — one gateway, one network — and not an
 *      ecosystem collapse. Nothing is confirmed, everything stays pending, and
 *      the caller is told so it can warn. Pending bundles are still counted as
 *      alive in the day's point and disclosed there as `unconfirmed`, so the
 *      number is never quietly wrong: it says how much of itself is unsure.
 *
 * The cost of both rules is latency — a real death shows up one run late, and a
 * genuine mass extinction would never be confirmed at all through a single
 * gateway. That is the correct trade for an index: being slow about bad news is
 * recoverable, publishing a fictional graveyard is not.
 */

/** Consecutive unreachable runs before a death is believed. See rule 1. */
export const CONFIRM_RUNS = 2;

/** Newest transitions kept in state.json. Old ones live on in the day series. */
export const MAX_TRANSITIONS = 500;

/**
 * How many deaths one run may confirm before the run reads as a correlated
 * failure. A share of the deployed bundles rather than a constant, with a floor
 * so a three-app ecosystem is not held hostage by rounding.
 */
export function waveThreshold(deployed) {
  return Math.max(3, Math.ceil(deployed * 0.25));
}

/** The UTC day `at` (unix seconds) falls in, as YYYY-MM-DD. */
export function utcDay(at) {
  return new Date(at * 1000).toISOString().slice(0, 10);
}

/**
 * Fold one probe run into the series.
 *
 * @param previous  the `liveness` block from indexer/state.json, or {}
 * @param probe     Map<label, boolean>: this run's raw verdicts, probed names
 *                  only. A name absent from the map has nothing to probe and
 *                  makes no liveness claim at all — any claim it used to make is
 *                  dropped rather than left standing.
 * @param now       unix seconds of this run
 * @param gateway   the gateway the verdicts came through, recorded with the
 *                  day's point because one door is all any of them saw
 * @returns { liveness, point, changes } — nothing is written here; the caller
 *          owns the files.
 */
export function accumulate({ previous = {}, probe, now, gateway }) {
  const confirmed = { ...(previous.state ?? {}) };
  const pending = { ...(previous.pendingDown ?? {}) };
  const transitions = Array.isArray(previous.transitions) ? [...previous.transitions] : [];

  const probed = [...probe.keys()].sort();
  const threshold = waveThreshold(probed.length);

  // Two passes: decide every death first, then commit them — rule 2 is a
  // judgement about the RUN, and it cannot be made one label at a time.
  const wouldDie = [];
  const recovered = [];
  const stillPending = {};

  for (const label of probed) {
    const up = probe.get(label);

    if (up) {
      // A served bundle settles every open question about this label at once.
      if (confirmed[label] === 'unreachable') recovered.push(label);
      confirmed[label] = 'alive';
      continue;
    }

    // Already known to be unreachable: nothing changes, and it must not be
    // re-counted as a fresh death on every run.
    if (confirmed[label] === 'unreachable') continue;

    const seen = pending[label];
    const since = seen?.since ?? now;
    const runs = Math.min((seen?.runs ?? 0) + 1, CONFIRM_RUNS);
    if (runs >= CONFIRM_RUNS) wouldDie.push({ label, since, runs });
    else stillPending[label] = { since, runs };
  }

  // Rule 2: a wave is held whole. The pending counters are kept at the
  // confirmation mark, so the moment the run stops looking like a wave the
  // deaths are recorded with their ORIGINAL timestamps — held, not lost.
  const wave = wouldDie.length > threshold;
  const died = wave ? [] : wouldDie;
  if (wave) {
    for (const d of wouldDie) stillPending[d.label] = { since: d.since, runs: d.runs, held: true };
  }

  for (const { label, since, runs } of died) {
    transitions.push({
      label,
      from: confirmed[label] ?? 'unknown',
      to: 'unreachable',
      // WHEN it went unreachable is the first sighting; WHEN we believed it is
      // this run. Both are recorded because they are different facts.
      at: since,
      confirmedAt: now,
      afterRuns: runs,
    });
    confirmed[label] = 'unreachable';
  }
  for (const label of recovered) {
    transitions.push({ label, from: 'unreachable', to: 'alive', at: now });
  }

  // A name with nothing to probe may not keep a liveness claim of any kind.
  for (const label of Object.keys(confirmed)) if (!probe.has(label)) delete confirmed[label];

  const alive = probed.filter((l) => confirmed[l] === 'alive').length;
  const point = {
    day: utcDay(now),
    at: now,
    // alive OUT OF deployed: bundles whose contenthash this probe could ask
    // about at all. Names with no bundle are not in either number.
    alive,
    deployed: probed.length,
    // How much of `alive` is a bundle the gateway refused at least once but
    // that is not yet believed dead. Disclosed so the count says how sure it is.
    unconfirmed: Object.keys(stillPending).length,
    gateway,
  };

  return {
    liveness: {
      updatedAt: new Date(now * 1000).toISOString(),
      confirmRuns: CONFIRM_RUNS,
      state: confirmed,
      pendingDown: stillPending,
      transitions: transitions.slice(-MAX_TRANSITIONS),
    },
    point,
    changes: {
      died: died.map((d) => d.label),
      recovered,
      pending: Object.keys(stillPending),
      /** Deaths this run refused to confirm because they arrived together. */
      heldAsWave: wave ? wouldDie.map((d) => d.label) : [],
      threshold,
    },
  };
}

/**
 * Upsert `point` into an append-style ledger, ONE POINT PER UTC DAY.
 *
 * Read-modify-write rather than a plain append, because the probe runs several
 * times a day: the last measurement of a day replaces the earlier one instead of
 * adding a second row for the same date. A day therefore reports the state at
 * `at`, not an average over the day — and `at` is in every row so that claim is
 * checkable rather than assumed.
 */
export function upsertDay(lines, point) {
  const kept = [];
  for (const line of lines) {
    try {
      if (JSON.parse(line).day !== point.day) kept.push(line);
    } catch {
      // A corrupt row is dropped rather than propagated: it can no longer be
      // read as a measurement, and keeping it would poison every later parse.
    }
  }
  kept.push(JSON.stringify(point));
  return kept;
}

/** Median of a numeric list, or null when there is nothing to take a median of. */
function median(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  const m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/**
 * The death toll and how long apps lived, computed from the CONFIRMED liveness
 * state — never from a single run's raw probe. A "death" is a deployed name whose
 * bundle became unreachable and STAYED so long enough to be believed
 * (see {@link accumulate} rules 1 and 2): `state[label] === 'unreachable'`.
 *
 * Both honesty rules that matter here are already paid for upstream: a name is
 * only in `unreachable` after {@link CONFIRM_RUNS} runs and never as part of a
 * wave. So this function does no guarding of its own — it reads the settled
 * verdict and reports lifespans over it. When nothing has died it says so
 * literally: `deaths: []`, `medianLifespanDays: null`. It never invents a zero.
 *
 * @param liveness  the `liveness` block from state.json ({ state, transitions })
 * @param apps      the apps.json map — for `firstSeenAt` (birth) and
 *                  `lastSeenAliveAt` (the last probe that found the bundle up)
 * @param probedThisRun  how many contenthashes this run could probe at all
 * @returns { deaths, medianLifespanDays, deadNow }
 */
export function survival({ liveness = {}, apps = {}, probedThisRun = 0 }) {
  const state = liveness.state ?? {};
  const transitions = Array.isArray(liveness.transitions) ? liveness.transitions : [];

  // WHEN each label last went unreachable. Transitions are appended in order, so
  // the last matching one is the current death's moment — a revived-then-died
  // app reports its most recent death, not its first.
  const deadSinceOf = new Map();
  for (const t of transitions) {
    if (t && t.to === 'unreachable' && typeof t.at === 'number') deadSinceOf.set(t.label, t.at);
  }

  const deadLabels = Object.keys(state)
    .filter((l) => state[l] === 'unreachable')
    .sort();

  const deaths = deadLabels.map((label) => {
    const entry = apps[label] ?? {};
    const deadSince = deadSinceOf.has(label) ? deadSinceOf.get(label) : null;
    const firstSeenAt = typeof entry.firstSeenAt === 'number' ? entry.firstSeenAt : null;
    const lastAliveAt = typeof entry.lastSeenAliveAt === 'number' ? entry.lastSeenAliveAt : null;
    // Lifespan is birth → death. Null — not zero — when either end is unknown:
    // an unmeasurable span is a different statement from "it lived no time".
    const lifespanDays =
      firstSeenAt !== null && deadSince !== null
        ? Math.round(((deadSince - firstSeenAt) / 86_400) * 10) / 10
        : null;
    return {
      label,
      displayName: typeof entry.displayName === 'string' ? entry.displayName : undefined,
      deadSince,
      lastAliveAt,
      lifespanDays,
    };
  });

  return {
    deaths,
    medianLifespanDays: median(deaths.map((d) => d.lifespanDays)),
    probedThisRun,
    deadNow: deadLabels.length,
  };
}
