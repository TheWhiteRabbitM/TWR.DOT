/**
 * Reading the ballots, and the identity that never appears in them.
 */
import { Contract, JsonRpcProvider } from 'ethers';

/** SecretBallot, deployed on devnet 2026-08-20. A real ring signature made in a
 *  browser was verified by this contract, a tampered one was refused, and a
 *  proof replayed onto a different answer was refused too. */
export const BALLOT = '0x7921323f3F926d6A17513291e7616a6B4fA01aC3';
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
const ABI = [
  'function count() view returns (uint256)',
  'function questionOf(uint256) view returns (string)',
  'function optionsOf(uint256) view returns (string[])',
  'function tallies(uint256) view returns (uint32[])',
  'function ringOf(uint256) view returns (uint256[2][])',
  'function enrolled(uint256 poll, uint256 mask) view returns (bool)',
  'function used(uint256 poll, bytes32 image) view returns (bool)',
  'function ballotMessage(uint256 id, uint8 option) view returns (bytes32)',
  'function meta(uint256 id) view returns (uint256 opener, uint64 at, bool closedRing, uint256 ringSize, uint32 cast_, uint8 options)',
];

let cached: Promise<JsonRpcProvider> | null = null;
export function connect(): Promise<JsonRpcProvider> {
  cached ??= (async () => {
    for (const url of RPCS) {
      try {
        const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 20, staticNetwork: true });
        await p.getBlockNumber();
        return p;
      } catch { /* next */ }
    }
    cached = null;
    throw new Error('no eth-rpc endpoint answered');
  })();
  return cached;
}

export interface Referendum {
  index: number;
  title: string;
  state: string;
  track: string;
  ayes: number;
  nays: number;
  url: string;
  pollId?: number;
}

export async function loadReferenda(): Promise<Referendum[]> {
  const r = await fetch(`${import.meta.env.BASE_URL}referenda.json`);
  if (!r.ok) throw new Error(`referenda.json — HTTP ${r.status}`);
  const j = (await r.json()) as { referenda: Referendum[] };
  return j.referenda.filter((x) => x.pollId != null);
}

export interface Ballot {
  pollId: number;
  options: string[];
  tallies: number[];
  ringSize: number;
  cast: number;
  ring: [bigint, bigint][];
}

export async function readBallot(pollId: number): Promise<Ballot> {
  const p = await connect();
  const c = new Contract(BALLOT, ABI, p);
  const [options, tal, m, ring] = await Promise.all([
    c.optionsOf(pollId) as Promise<string[]>,
    c.tallies(pollId) as Promise<bigint[]>,
    c.meta(pollId),
    c.ringOf(pollId) as Promise<bigint[][]>,
  ]);
  return {
    pollId,
    options,
    tallies: tal.map(Number),
    ringSize: Number(m.ringSize),
    cast: Number(m.cast_),
    ring: ring.map((p2) => [p2[0], p2[1]] as [bigint, bigint]),
  };
}

export async function isEnrolled(pollId: number, mask: bigint): Promise<boolean> {
  const p = await connect();
  return new Contract(BALLOT, ABI, p).enrolled(pollId, mask);
}

export async function messageFor(pollId: number, option: number): Promise<bigint> {
  const p = await connect();
  return BigInt(await new Contract(BALLOT, ABI, p).ballotMessage(pollId, option));
}

export async function imageUsed(pollId: number, image: string): Promise<boolean> {
  const p = await connect();
  return new Contract(BALLOT, ABI, p).used(pollId, image);
}
