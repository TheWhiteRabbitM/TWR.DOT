import survival from './liveness.json';

/**
 * The ecosystem liveness series: how many deployed bundles were still being
 * served, one point per UTC day.
 *
 * WHY A SERIES AND NOT A NUMBER. Bulletin keeps an object for about fourteen
 * days, so "34 of 36 bundles are up" is a fact that expires. What does not
 * expire is the shape of it over time — whether the ecosystem is renewing what
 * it publishes or quietly letting it lapse. `indexer/probe-liveness.mjs` appends
 * one point per day, and `indexer/liveness-history.mjs` documents the two rules
 * that keep a sick gateway from being written in here as a wave of deaths.
 */
export interface LivenessPoint {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  /**
   * Unix seconds of the measurement this point reports. A day's point is the
   * LAST probe of that day, not an average over it — which is why the exact
   * moment travels with the numbers instead of being implied by the date.
   */
  at: number;
  /** Bundles the gateway served, out of {@link deployed}. */
  alive: number;
  /**
   * The denominator: names whose contenthash record could be probed at all.
   * Names with no bundle are in neither number.
   */
  deployed: number;
  /**
   * How much of `alive` is a bundle the gateway refused at least once but that
   * is not yet believed dead. `0` means the count is unqualified; anything else
   * is the count's own margin, and a reader is owed it.
   */
  unconfirmed: number;
  /**
   * The single gateway every verdict in this point came through. Recorded
   * because one door is all any probe ever saw — a point measures reachability
   * through this host, not existence on the network.
   */
  gateway: string;
}

/**
 * One app that died: a deployed name whose bundle went unreachable and stayed so
 * long enough for `indexer/liveness-history.mjs` to believe it (two consecutive
 * runs, and never as part of a wave). Nulls are load-bearing — an unknown span is
 * not the same claim as a zero-length one, and the UI must word it differently.
 */
export interface Death {
  /** The `<label>.dot` short label. */
  label: string;
  /** `manifest.displayName`, when the name published one. */
  displayName?: string;
  /** Unix seconds the bundle went unreachable, or null when unrecorded. */
  deadSince: number | null;
  /** Unix seconds of the last probe that still found it up, or null if never. */
  lastAliveAt: number | null;
  /** firstSeenAt → deadSince, in days; null when either end is unknown. */
  lifespanDays: number | null;
}

/**
 * The survival record: the day series plus what has died and how long the dead
 * lived. `indexer/probe-liveness.mjs` writes it from the CONFIRMED liveness
 * state, so a death is here only after it entered the transition log.
 *
 * HONEST EMPTIES ARE LITERAL. When nothing has died, `deaths` is `[]` and
 * `medianLifespanDays` is `null` — never a fabricated 0. A consumer reads the
 * null as "no deaths to take a median of", which is the true statement.
 */
export interface Survival {
  /** Every recorded day, oldest first. Empty until the indexer has run once. */
  series: LivenessPoint[];
  /** Apps believed dead, one entry each. `[]` when none have died. */
  deaths: Death[];
  /** Median lifespan over the dead, in days. `null` when none have died. */
  medianLifespanDays: number | null;
  /** How many contenthashes the last run could probe at all — the denominator. */
  probedThisRun: number;
  /** How many bundles are confirmed unreachable right now. */
  deadNow: number;
}

/** The whole survival record baked at the last refresh. */
export const SURVIVAL: Survival = survival as Survival;

/** Every recorded day, oldest first. Empty until the indexer has run at least once. */
export const LIVENESS: LivenessPoint[] = SURVIVAL.series;
