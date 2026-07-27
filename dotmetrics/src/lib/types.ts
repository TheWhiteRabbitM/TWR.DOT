import type { MsgKey } from './i18n';

/** One headline metric for an app. */
export interface Metric {
  /**
   * An i18n key, not a finished string.
   *
   * Stats are fetched once and held in state, so a label baked in at read time
   * would still be in the old language after the reader switches. Keeping the
   * key means the label is resolved during render, every render — and typing it
   * as {@link MsgKey} means a label with no Italian translation cannot compile.
   */
  label: MsgKey;
  value: number;
  /** Optional: a short qualifier shown under the value. */
  note?: string;
}

/** A recent activity item (for the ecosystem feed). */
export interface Activity {
  app: string;
  /**
   * Free text from the chain — a petition title someone wrote. NOT ours, and
   * therefore never translated: see the description handling in App.tsx.
   */
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
 *   0 published  — a readable `manifest` record
 *   1 deployed   — a contenthash (a bundle is up) but nothing describing it
 *   2 name only  — the name is registered and that is all
 *
 * Every one of these is a fact ANY name can satisfy by publishing a record.
 * There used to be a tier above them — "live data", for the apps dotmetrics had
 * hand-coded a contract reader for — and all four of those apps belonged to the
 * index's own operator, so the top of a public ranking was reachable only by the
 * person running it. It also broke the rule the tiers exist to keep: a tier
 * states a fact about the APP, and that one stated a fact about our code.
 */
export type Tier = 0 | 1 | 2;

/** Static definition of a .dot app in the directory. */
export interface AppEntry {
  id: string;
  name: string;
  domain: string;
  /**
   * Our one-line description of an app we read a contract for, as an i18n key.
   * Only ever rendered for an entry that publishes no manifest description of
   * its own — an author's own words always win over ours.
   */
  tagline: MsgKey;
  /**
   * The contract address the NAME declares, from a `contract` text record on
   * `<label>.dot`, lowercased. `''` when the name declares none.
   *
   * dotmetrics' own convention, not a platform standard: no manifest field
   * exists for a contract address, so without this record no per-app number can
   * be attributed to a name at all. Declaring one is the route any app has to a
   * measured figure of its own — the count of `revive.ContractEmitted` events
   * for the address, which needs no ABI and no cooperation from us.
   */
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
   * Reads stats through an ABI dotmetrics hard-codes for this app. `null` for
   * every name we have not hand-coded, which is nearly all of them.
   *
   * This is OUR INSTRUMENTATION and nothing more. It does not set the tier, it
   * does not affect the ranking, and it is rendered under a line that says
   * whose reading it is — see 'ours.*' in the dictionary. Anything a reader is
   * invited to compare apps by has to be something every app can obtain.
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
