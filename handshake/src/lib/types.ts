/** Agreement lifecycle, mirrored from the contract's State enum (0..4). */
export type AgreementState = 'proposed' | 'accepted' | 'sealed' | 'completed' | 'withdrawn';

export interface AgreementRow {
  id: number;
  /** Proposer's contextAlias, hex. */
  proposer: string;
  /** Acceptor's contextAlias, hex — null until someone accepts. */
  acceptor: string | null;
  proposerTier: number;
  acceptorTier: number;
  createdAt: number;
  sealedAt: number;
  completedAt: number;
  state: AgreementState;
  proposerDone: boolean;
  acceptorDone: boolean;
  terms: string;
}

/** One person's kept-word record. */
export interface KeptWord {
  sealed: number;
  completed: number;
}

/** The visitor's standing. */
export interface MyState {
  tier: number;
  alias: string;
  username: string | null;
  record: KeptWord;
}

export interface HandshakeDriver {
  readonly mocked: boolean;
  /** The visitor's agreements (both roles), newest first, plus their standing. */
  myAgreements(): Promise<{ rows: AgreementRow[]; me: MyState }>;
  /** One agreement by id — needed for link-opened agreements. */
  getOne(id: number): Promise<AgreementRow>;
  /** Kept-word record for any alias (to show the other party's). */
  recordOf(alias: string): Promise<KeptWord>;
  propose(terms: string): Promise<number>;
  accept(id: number): Promise<void>;
  seal(id: number): Promise<void>;
  withdraw(id: number): Promise<void>;
  markDone(id: number): Promise<void>;
  onStep?: (step: string) => void;
}
