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
  /** Accent colour for the card. */
  accent: string;
  /** Emoji/mark fallback. */
  glyph: string;
  /** Block where the indexer first saw this name registered. */
  firstSeenBlock?: number;
  /** Wall-clock time of that block (unix seconds), when the indexer resolved it. */
  firstSeenAt?: number;
  /**
   * Reads live stats. `null` for discovered apps whose contract we don't know:
   * they are listed in the directory, just without metrics.
   */
  read: ((readContract: ReadContract) => Promise<AppStats>) | null;
}

/** A minimal ethers-like contract reader, injected so the registry stays pure. */
export type ReadContract = (address: string, abi: string[]) => {
  [method: string]: (...args: unknown[]) => Promise<unknown>;
};
