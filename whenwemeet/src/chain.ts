/**
 * Reading the polls.
 *
 * A poll is a row in a contract: a title, up to sixteen options, and a count per
 * option. Nothing is kept anywhere else, so there is no service to go down, no
 * account to make, and nobody holding a list of when you are free.
 */
import { Contract, JsonRpcProvider } from 'ethers';

/** WhenWe, deployed and proven on devnet 2026-08-20: the mask gate holds, a poll
 *  was opened and voted, and changing a vote moved the tallies without counting
 *  the voter twice. */
export const WHENWE = '0x707e80b9640CC3935D570290879576386D5a81e7';
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];

const ABI = [
  'function count() view returns (uint256)',
  'function titleOf(uint256) view returns (string)',
  'function optionsOf(uint256) view returns (string[])',
  'function tallies(uint256) view returns (uint32[])',
  'function meta(uint256 id) view returns (uint256 mask, address opener, uint64 at, uint8 options, uint32 people)',
  'function ballotOf(uint256 id, uint256 mask) view returns (uint32 bitmap, bool answered)',
];
const MASKS_ABI = [
  'function profileOf(uint256 id) view returns (string displayName, string telegram, string x, string bio)',
];

let cached: Promise<JsonRpcProvider> | null = null;
export function connect(): Promise<JsonRpcProvider> {
  cached ??= (async () => {
    for (const url of RPCS) {
      try {
        const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 20, staticNetwork: true });
        await p.getBlockNumber();
        return p;
      } catch {
        /* next */
      }
    }
    cached = null;
    throw new Error('no eth-rpc endpoint answered');
  })();
  return cached;
}

export interface Poll {
  id: number;
  title: string;
  options: string[];
  tallies: number[];
  people: number;
  mask: bigint;
  at: number;
}

export async function pollCount(): Promise<number> {
  const p = await connect();
  return Number(await new Contract(WHENWE, ABI, p).count());
}

export async function readPoll(id: number): Promise<Poll> {
  const p = await connect();
  const c = new Contract(WHENWE, ABI, p);
  const [title, options, tal, m] = await Promise.all([
    c.titleOf(id) as Promise<string>,
    c.optionsOf(id) as Promise<string[]>,
    c.tallies(id) as Promise<bigint[]>,
    c.meta(id),
  ]);
  return {
    id,
    title,
    options,
    tallies: tal.map(Number),
    people: Number(m.people),
    mask: m.mask,
    at: Number(m.at),
  };
}

/** Newest first, because a poll people are answering now matters more than one
 *  answered last week. */
export async function recentPolls(limit = 20): Promise<Poll[]> {
  const n = await pollCount();
  if (n === 0) return [];
  const ids: number[] = [];
  for (let i = n - 1; i >= 0 && ids.length < limit; i -= 1) ids.push(i);
  return Promise.all(ids.map(readPoll));
}

export async function myBallot(id: number, mask: bigint): Promise<{ bitmap: number; answered: boolean }> {
  const p = await connect();
  const r = await new Contract(WHENWE, ABI, p).ballotOf(id, mask);
  return { bitmap: Number(r.bitmap), answered: Boolean(r.answered) };
}

export async function nameOfMask(mask: bigint): Promise<string> {
  if (mask === 0n) return '';
  try {
    const p = await connect();
    const pr = await new Contract(MASKS, MASKS_ABI, p).profileOf(mask);
    return pr?.displayName || `mask #${mask}`;
  } catch {
    return `mask #${mask}`;
  }
}
