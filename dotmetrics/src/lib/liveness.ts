import points from './liveness.json';

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
 *
 * NOTHING RENDERS THIS YET, deliberately: the data has to accumulate before a
 * chart of it can say anything true. Two points are not a trend.
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

/** Every recorded day, oldest first. Empty until the indexer has run at least once. */
export const LIVENESS: LivenessPoint[] = points as LivenessPoint[];
