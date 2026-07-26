import type { MyState, PetitionRow, PetitionsDriver } from './types';
import { TIER } from './config';

/**
 * Local stand-in so the register is fully usable outside the host container.
 * State persists in localStorage; signatures and authorship survive reloads.
 */
const KEY = 'petitions:mock';

interface MockState {
  rows: PetitionRow[];
  signed: Record<number, number>; // id -> tier signed at
  createdByMe: number;
}

function seed(): MockState {
  const now = Math.floor(Date.now() / 1000);
  return {
    rows: [
      {
        id: 0,
        author: '0xa7f3c1d9e2b48f60',
        createdAt: now - 86400 * 2,
        fullCount: 12,
        liteCount: 31,
        title: 'Keep the neighbourhood library open on Saturdays',
        bodyCid: '',
      },
      {
        id: 1,
        author: '0x3e91b7c4a0d5f218',
        createdAt: now - 86400,
        fullCount: 47,
        liteCount: 18,
        title: 'Add a safe pedestrian crossing outside the primary school',
        bodyCid: '',
      },
    ],
    signed: {},
    createdByMe: 0,
  };
}

function read(): MockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // fall through to a fresh seed
  }
  const fresh = seed();
  write(fresh);
  return fresh;
}

function write(state: MockState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // degrade to in-memory
  }
}

const MY_ALIAS = '0xyou';

/**
 * Demo tier override, so every verification state is testable on the web
 * without swapping accounts: append `?tier=none` (0), `?tier=lite` (1), or
 * `?tier=full` (2) to the URL. Defaults to full.
 */
function demoTier(): number {
  try {
    const t = new URLSearchParams(window.location.search).get('tier');
    if (t === 'none' || t === '0') return TIER.none;
    if (t === 'lite' || t === '1') return TIER.lite;
  } catch {
    // ignore
  }
  return TIER.full;
}

export function createMockDriver(username: string | null): PetitionsDriver {
  const me: MyState = { tier: demoTier(), alias: MY_ALIAS, username };

  return {
    mocked: true,

    async list() {
      return { rows: [...read().rows].sort((a, b) => b.id - a.id), me };
    },

    async signedTier(id: number) {
      return read().signed[id] ?? 0;
    },

    async sign(id: number) {
      const state = read();
      if (state.signed[id]) throw new Error('AlreadySigned: one signature per human');
      await new Promise((r) => setTimeout(r, 700));
      const row = state.rows.find((p) => p.id === id);
      if (!row) throw new Error(`UnknownPetition: ${id}`);
      row.fullCount += 1;
      state.signed[id] = TIER.full;
      write(state);
    },

    async create(title: string) {
      const state = read();
      if (state.createdByMe >= 5) throw new Error('TooManyPetitions: max 5 per human');
      await new Promise((r) => setTimeout(r, 700));
      const id = state.rows.length;
      state.rows.push({
        id,
        author: MY_ALIAS,
        createdAt: Math.floor(Date.now() / 1000),
        fullCount: 0,
        liteCount: 0,
        title,
        bodyCid: '',
      });
      state.createdByMe += 1;
      write(state);
      return id;
    },
  };
}
