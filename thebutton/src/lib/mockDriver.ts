import type { ButtonDriver, Presser } from './types';
import { TIER } from './config';

/**
 * Local stand-in for the deployed contract.
 *
 * Lets the whole UI be exercised before TheButton.sol is on chain. State lives
 * in localStorage so a press survives a reload, which is the one behaviour that
 * actually matters for this app.
 */
const KEY = 'thebutton:mock';

interface MockState {
  total: number;
  yourOrdinal: number | null;
  roll: Presser[];
}

/** A few prior pressers so the roll is not empty on first run. */
function seed(): MockState {
  const now = Math.floor(Date.now() / 1000);
  const names = [
    'a7f3c1d9e2b48f60',
    '3e91b7c4a0d5f218',
    'c40d8a1f6b93e572',
    '91b2e6f0c7a34d8e',
    'de5a0c39847bf162',
  ];
  return {
    total: names.length,
    yourOrdinal: null,
    roll: names.map((who, i) => ({
      ordinal: i + 1,
      who: `0x${who}${'0'.repeat(48)}`,
      pressedAt: now - (names.length - i) * 3600 - 120,
    })),
  };
}

function read(): MockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // Corrupt or unavailable storage just falls through to a fresh seed.
  }
  const fresh = seed();
  write(fresh);
  return fresh;
}

function write(state: MockState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Non-fatal: the mock degrades to in-memory for this page load.
  }
}

export function createMockDriver(username: string | null): ButtonDriver {
  return {
    async load() {
      const state = read();
      return {
        total: state.total,
        yourOrdinal: state.yourOrdinal,
        username,
        tier: TIER.full,
        roll: state.roll,
        mocked: true,
      };
    },

    async press() {
      const state = read();
      if (state.yourOrdinal !== null) return state.yourOrdinal;

      // Pretend a block had to be produced.
      await new Promise((r) => setTimeout(r, 900));

      const ordinal = state.total + 1;
      const entry: Presser = {
        ordinal,
        who: '0xyou',
        pressedAt: Math.floor(Date.now() / 1000),
      };
      write({ total: ordinal, yourOrdinal: ordinal, roll: [...state.roll, entry] });
      return ordinal;
    },
  };
}

/** Wipe mock state. Handy during development. */
export function resetMock(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
