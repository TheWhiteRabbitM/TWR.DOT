/**
 * Reading the watches.
 *
 * The contract is the only party to this arrangement. There is no service to
 * keep paying, no inbox to keep working, and nobody who has to remember you.
 */
import { Contract, JsonRpcProvider } from 'ethers';

/** StillHere, deployed and proven on devnet 2026-08-20. */
export const STILLHERE = '0xCcF0028497997989bfD7BD26560c367Ff4452BbA';
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
/** Roughly ten minutes of blocks, the shortest watch the contract accepts. */
export const MIN_WINDOW = 300;

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
const ABI = [
  'function count() view returns (uint256)',
  'function labelOf(uint256) view returns (string)',
  'function messageOf(uint256) view returns (string)',
  'function watchesOf(uint256 mask) view returns (uint256[])',
  'function meta(uint256 id) view returns (uint256 mask, address keeper, uint64 lastSeen, uint64 window, uint64 startedAt, bool cancelled, bool due, uint64 blocksLeft)',
];
const MASKS_ABI = ['function profileOf(uint256 id) view returns (string displayName, string telegram, string x, string bio)'];

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

export interface Watch {
  id: number;
  label: string;
  message: string;
  mask: bigint;
  lastSeen: number;
  window: number;
  startedAt: number;
  cancelled: boolean;
  due: boolean;
  blocksLeft: number;
}

export async function readWatch(id: number): Promise<Watch> {
  const p = await connect();
  const c = new Contract(STILLHERE, ABI, p);
  const [label, message, m] = await Promise.all([
    c.labelOf(id) as Promise<string>,
    c.messageOf(id) as Promise<string>,
    c.meta(id),
  ]);
  return {
    id,
    label,
    message,
    mask: m.mask,
    lastSeen: Number(m.lastSeen),
    window: Number(m.window),
    startedAt: Number(m.startedAt),
    cancelled: m.cancelled,
    due: m.due,
    blocksLeft: Number(m.blocksLeft),
  };
}

export async function allWatches(limit = 30): Promise<Watch[]> {
  const p = await connect();
  const n = Number(await new Contract(STILLHERE, ABI, p).count());
  const ids: number[] = [];
  for (let i = n - 1; i >= 0 && ids.length < limit; i -= 1) ids.push(i);
  return Promise.all(ids.map(readWatch));
}

export async function blockNow(): Promise<number> {
  return (await connect()).getBlockNumber();
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

/** Blocks are about two seconds here; say it in words people use. */
export function human(blocks: number): string {
  const s = blocks * 2;
  if (s < 90) return `${s} seconds`;
  if (s < 5400) return `${Math.round(s / 60)} minutes`;
  if (s < 172800) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86400)} days`;
}
