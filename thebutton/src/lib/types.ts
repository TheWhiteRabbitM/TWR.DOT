/** One entry in the press roll. */
export interface Presser {
  ordinal: number;
  /** contextAlias, hex. Pseudonymous and scoped to this app. */
  who: string;
  /** Unix seconds. */
  pressedAt: number;
}

export type Phase =
  | 'loading'
  /** Running outside the Polkadot host container and no mock is active. */
  | 'outside-host'
  /** Personhood tier below what the contract requires. */
  | 'not-human'
  /** Verified human who has not pressed yet. */
  | 'ready'
  /** Transaction in flight. */
  | 'pressing'
  /** This human has already pressed. */
  | 'pressed'
  | 'error';

export interface ButtonState {
  phase: Phase;
  /** Global press count. */
  total: number;
  /** This human's place in history, or null if they never pressed. */
  yourOrdinal: number | null;
  /** DotNS username of the current user, when the host exposes one. */
  username: string | null;
  /** Personhood tier: 0 none, 1 lite, 2 full. */
  tier: number;
  roll: Presser[];
  error: string | null;
  /** True when state is served by the local mock rather than a chain. */
  mocked: boolean;
  /**
   * Current chain step, shown while loading or pressing. Without it a stalled
   * await is indistinguishable from a slow one.
   */
  step: string | null;
}

export interface ButtonDriver {
  load(): Promise<Omit<ButtonState, 'phase' | 'error' | 'step'>>;
  press(): Promise<number>;
}
