/** One headline metric for an app. */
export interface Metric {
  label: string;
  value: number;
  /** Optional: a short qualifier shown under the value. */
  note?: string;
}

/** A recent activity item (for the ecosystem feed). */
export interface Activity {
  app: string;
  text: string;
  /** Unix seconds, when known. */
  at?: number;
}

/** Live-read result for one app. */
export interface AppStats {
  /** Headline number shown big on the card. */
  headline: Metric;
  /** Secondary metrics. */
  metrics: Metric[];
  activity: Activity[];
}

/**
 * How much of an app actually exists on-chain. Derived from chain facts at
 * index time, never from a judgement about quality:
 *
 *   0 live data  — dotmetrics has a contract reader for it
 *   1 published  — a readable `manifest` record
 *   2 deployed   — a contenthash (a bundle is up) but nothing describing it
 *   3 name only  — the name is registered and that is all
 */
export type Tier = 0 | 1 | 2 | 3;

/** Static definition of a .dot app in the directory. */
export interface AppEntry {
  id: string;
  name: string;
  domain: string;
  tagline: string;
  /** Deployed contract address on Asset Hub. */
  contract: string;
  /** Public web URL (gateway). */
  url: string;
  /** Block where the indexer first saw this name registered. */
  firstSeenBlock?: number;
  /** Wall-clock time of that block (unix seconds), when the indexer resolved it. */
  firstSeenAt?: number;
  /** `registry.owner()` for the name, checksummed. '' only for code fallbacks. */
  owner: string;
  /** `manifest.displayName`, when the name publishes a manifest. */
  displayName?: string;
  /** `manifest.description`. */
  description?: string;
  /** `manifest.icon.cid`. */
  iconCid?: string;
  /** `baf…` contenthash: the deployed bundle. */
  contenthash?: string;
  /** An `executable` record exists on `app.<label>.dot`. */
  hasExecutable: boolean;
  tier: Tier;
  /**
   * Reads live stats. `null` for discovered apps whose contract we don't know:
   * they are listed in the directory, just without metrics.
   */
  read: ((readContract: ReadContract) => Promise<AppStats>) | null;
  /**
   * @deprecated Decorative colour and emoji are gone from the directory: the
   * redesign renders names, not badges. Nothing populates these — they remain
   * only so older call sites keep compiling while the UI is rewritten.
   */
  accent?: string;
  /** @deprecated See {@link AppEntry.accent}. */
  glyph?: string;
}

/** A minimal ethers-like contract reader, injected so the registry stays pure. */
export type ReadContract = (address: string, abi: string[]) => {
  [method: string]: (...args: unknown[]) => Promise<unknown>;
};
