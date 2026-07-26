import type { AgreementRow, HandshakeDriver, KeptWord, MyState } from './types';
import { TIER } from './config';

/**
 * Local stand-in so the whole flow is walkable outside the Polkadot host.
 * You play BOTH parties: proposals you create can be accepted from the same
 * device, which is exactly what a demo needs.
 */
const KEY = 'handshake:mock';

const MY_ALIAS = '0xyou';
const OTHER_ALIAS = '0x3e91b7c4a0d5f218';

interface MockState {
  rows: AgreementRow[];
  records: Record<string, KeptWord>;
}

function seed(): MockState {
  const now = Math.floor(Date.now() / 1000);
  return {
    rows: [
      {
        id: 0,
        proposer: OTHER_ALIAS,
        acceptor: MY_ALIAS,
        proposerTier: TIER.full,
        acceptorTier: TIER.full,
        createdAt: now - 86400 * 6,
        sealedAt: now - 86400 * 5,
        completedAt: now - 86400 * 2,
        state: 'completed',
        proposerDone: true,
        acceptorDone: true,
        terms:
          'I lend you my camping tent for the first week of August. You return it clean by August 10th, and replace it if it gets damaged.',
      },
      {
        id: 1,
        proposer: MY_ALIAS,
        acceptor: null,
        proposerTier: TIER.full,
        acceptorTier: 0,
        createdAt: now - 3600 * 5,
        sealedAt: 0,
        completedAt: 0,
        state: 'proposed',
        proposerDone: false,
        acceptorDone: false,
        terms:
          'I am selling you my e-reader for 40 in cash. It works, battery holds a week. You can return it within 7 days if anything is wrong.',
      },
    ],
    records: {
      [MY_ALIAS]: { sealed: 1, completed: 1 },
      [OTHER_ALIAS]: { sealed: 1, completed: 1 },
    },
  };
}

function read(): MockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // fall through
  }
  const fresh = seed();
  write(fresh);
  return fresh;
}

function write(state: MockState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // degrade to memory
  }
}

function bump(records: Record<string, KeptWord>, alias: string, field: keyof KeptWord): void {
  const r = records[alias] ?? { sealed: 0, completed: 0 };
  r[field] += 1;
  records[alias] = r;
}

async function delay(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600));
}

export function createMockDriver(username: string | null): HandshakeDriver {
  const me = (): MyState => ({
    tier: TIER.full,
    alias: MY_ALIAS,
    username,
    record: read().records[MY_ALIAS] ?? { sealed: 0, completed: 0 },
  });

  return {
    mocked: true,

    async myAgreements() {
      const rows = read()
        .rows.filter((a) => a.proposer === MY_ALIAS || a.acceptor === MY_ALIAS)
        .sort((a, b) => b.id - a.id);
      return { rows, me: me() };
    },

    async getOne(id: number) {
      const row = read().rows.find((a) => a.id === id);
      if (!row) throw new Error(`No agreement #${id}`);
      return row;
    },

    async recordOf(alias: string) {
      return read().records[alias] ?? { sealed: 0, completed: 0 };
    },

    async propose(terms: string) {
      await delay();
      const state = read();
      const id = state.rows.length;
      state.rows.push({
        id,
        proposer: MY_ALIAS,
        acceptor: null,
        proposerTier: TIER.full,
        acceptorTier: 0,
        createdAt: Math.floor(Date.now() / 1000),
        sealedAt: 0,
        completedAt: 0,
        state: 'proposed',
        proposerDone: false,
        acceptorDone: false,
        terms,
      });
      write(state);
      return id;
    },

    async accept(id: number) {
      await delay();
      const state = read();
      const a = state.rows.find((r) => r.id === id);
      if (!a || a.state !== 'proposed') throw new Error('This proposal cannot be accepted.');
      // In the demo the "other person" accepts your own proposals.
      a.acceptor = a.proposer === MY_ALIAS ? OTHER_ALIAS : MY_ALIAS;
      a.acceptorTier = TIER.full;
      a.state = 'accepted';
      write(state);
    },

    async seal(id: number) {
      await delay();
      const state = read();
      const a = state.rows.find((r) => r.id === id);
      if (!a || a.state !== 'accepted') throw new Error('Nothing to seal.');
      a.state = 'sealed';
      a.sealedAt = Math.floor(Date.now() / 1000);
      bump(state.records, a.proposer, 'sealed');
      if (a.acceptor) bump(state.records, a.acceptor, 'sealed');
      write(state);
    },

    async withdraw(id: number) {
      await delay();
      const state = read();
      const a = state.rows.find((r) => r.id === id);
      if (!a || (a.state !== 'proposed' && a.state !== 'accepted')) {
        throw new Error('This agreement can no longer be withdrawn.');
      }
      a.state = 'withdrawn';
      write(state);
    },

    async markDone(id: number) {
      await delay();
      const state = read();
      const a = state.rows.find((r) => r.id === id);
      if (!a || a.state !== 'sealed') throw new Error('Only sealed agreements can be completed.');
      if (a.proposer === MY_ALIAS && !a.proposerDone) a.proposerDone = true;
      else if (a.acceptor === MY_ALIAS && !a.acceptorDone) a.acceptorDone = true;
      // The demo counterparty confirms right after you.
      else throw new Error('Already marked.');
      if (!a.proposerDone || !a.acceptorDone) {
        if (a.proposer === MY_ALIAS) a.acceptorDone = true;
        else a.proposerDone = true;
      }
      if (a.proposerDone && a.acceptorDone) {
        a.state = 'completed';
        a.completedAt = Math.floor(Date.now() / 1000);
        bump(state.records, a.proposer, 'completed');
        if (a.acceptor) bump(state.records, a.acceptor, 'completed');
      }
      write(state);
    },
  };
}
