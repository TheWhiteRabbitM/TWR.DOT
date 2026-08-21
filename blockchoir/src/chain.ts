/**
 * Reading the board.
 *
 * There is nothing to read but the chain. The picture is not a file kept
 * somewhere and mirrored here: it is 64 words of contract storage, and this
 * unpacks them. No server, no indexer, no cache that could show you a canvas
 * the chain disagrees with.
 */
import { Contract, JsonRpcProvider } from 'ethers';

/** BlockCanvas, deployed and proven on devnet 2026-08-20: the mask gate holds,
 *  a pixel was written and read back, and the cooldown refused the second one. */
export const CANVAS = '0x7cA0698F6aE709d797f0AC9881D21472cc9657b4';
/** PeoplebookMasks2 — one mask to an account, the reason this game is playable. */
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';

export const SIDE = 64;
export const PIXELS = SIDE * SIDE;

/** Sixteen colours. Polkadot pink leads, then a spread wide enough to draw with
 *  and dark enough to sit on a near-black ground. Index 0 is the empty canvas. */
export const PALETTE = [
  '#0f0f0f', '#ffffff', '#ff2670', '#e4ff07',
  '#07ffff', '#7916f3', '#00b2ff', '#56f39a',
  '#ff8a00', '#ff4d4d', '#2ecc71', '#1b6ac9',
  '#b06cff', '#8c6239', '#a8a29e', '#57534e',
] as const;

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];

const ABI = [
  'function board() view returns (uint256[64])',
  'function totalPlaced() view returns (uint32)',
  'function lastChangedAt() view returns (uint64)',
  'function waitFor(uint256 mask) view returns (uint64)',
  'function placedBy(uint256 mask) view returns (uint32)',
  'function COOLDOWN() view returns (uint64)',
];
const MASKS_ABI = [
  'function maskOf(address) view returns (uint256)',
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

export interface Snapshot {
  /** One colour index per pixel, row major. */
  pixels: Uint8Array;
  total: number;
  block: number;
  lastChangedAt: number;
}

/** Unpack the 64 storage words into 4096 nibbles. */
export function unpack(words: bigint[]): Uint8Array {
  const out = new Uint8Array(PIXELS);
  for (let w = 0; w < words.length; w += 1) {
    let word = words[w];
    for (let i = 0; i < 64; i += 1) {
      out[w * 64 + i] = Number(word & 0xfn);
      word >>= 4n;
    }
  }
  return out;
}

export async function readBoard(): Promise<Snapshot> {
  const p = await connect();
  const c = new Contract(CANVAS, ABI, p);
  const [words, total, changed, block] = await Promise.all([
    c.board() as Promise<bigint[]>,
    c.totalPlaced() as Promise<bigint>,
    c.lastChangedAt() as Promise<bigint>,
    p.getBlockNumber(),
  ]);
  return { pixels: unpack(words), total: Number(total), block, lastChangedAt: Number(changed) };
}

/** Blocks this mask must still wait, straight from the contract rather than
 *  counted here: a client that guesses the cooldown eventually guesses wrong. */
export async function waitFor(mask: bigint): Promise<number> {
  const p = await connect();
  return Number(await new Contract(CANVAS, ABI, p).waitFor(mask));
}

export async function placedBy(mask: bigint): Promise<number> {
  const p = await connect();
  return Number(await new Contract(CANVAS, ABI, p).placedBy(mask));
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

export const xy = (index: number) => ({ x: index % SIDE, y: Math.floor(index / SIDE) });
export const idx = (x: number, y: number) => y * SIDE + x;
