/** One petition as the register shows it. */
export interface PetitionRow {
  id: number;
  /** Creator's contextAlias, hex. Pseudonymous, scoped to this app. */
  author: string;
  /** Unix seconds. */
  createdAt: number;
  /** Signatures from Full-tier humans — the number that matters. */
  fullCount: number;
  /** Signatures from Lite-tier accounts — disclosed, never merged. */
  liteCount: number;
  title: string;
  bodyCid: string;
}

/** The visitor's standing. */
export interface MyState {
  /** Personhood tier: 0 none, 1 lite, 2 full. */
  tier: number;
  /** contextAlias in this app, hex. */
  alias: string;
  /** DotNS username when the host exposes one. */
  username: string | null;
}

export interface PetitionsDriver {
  /** True when state is served locally rather than from a chain. */
  readonly mocked: boolean;
  /** Load the register plus the visitor's standing. */
  list(): Promise<{ rows: PetitionRow[]; me: MyState }>;
  /** Tier this visitor signed `id` at, or 0. */
  signedTier(id: number): Promise<number>;
  /** Sign petition `id`. Rejects on AlreadySigned / NotHuman. */
  sign(id: number): Promise<void>;
  /** Open a petition; resolves to its id. */
  create(title: string): Promise<number>;
  /** Reports the current step for slow operations. */
  onStep?: (step: string) => void;
}
