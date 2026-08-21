/**
 * Reading a tab, and doing the arithmetic here rather than on chain.
 *
 * The contract keeps facts: who paid, how much, split between whom. It does not
 * compute balances, because computing balances means deciding who eats the last
 * cent, and that is a policy rather than a fact. Every reader derives the same
 * numbers from the same entries and can check them.
 */
import { Contract, JsonRpcProvider } from 'ethers';

/** WhoPays, deployed and proven on devnet 2026-08-20. */
export const WHOPAYS = '0xbB584a13CDb814cb68ab6ce7BD375896A5f01929';
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
const ABI = [
  'function tabCount() view returns (uint256)',
  'function tabMeta(uint256 id) view returns (uint256 mask, uint64 at, string name, string unit, uint256[] members, uint256 entries)',
  'function entryIds(uint256 id) view returns (uint256[])',
  'function entry(uint256 e) view returns (uint256 tab, uint256 payer, uint64 at, uint128 amount, uint32 shareBits, string what)',
  'function isMember(uint256 tab, uint256 mask) view returns (bool)',
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

export interface Entry {
  id: number;
  payer: bigint;
  amount: bigint;
  shareBits: number;
  what: string;
  at: number;
}
export interface Tab {
  id: number;
  name: string;
  unit: string;
  members: bigint[];
  opener: bigint;
  entries: Entry[];
}

export async function tabCount(): Promise<number> {
  const p = await connect();
  return Number(await new Contract(WHOPAYS, ABI, p).tabCount());
}

export async function readTab(id: number): Promise<Tab> {
  const p = await connect();
  const c = new Contract(WHOPAYS, ABI, p);
  const m = await c.tabMeta(id);
  const ids: bigint[] = await c.entryIds(id);
  const entries = await Promise.all(
    ids.map(async (e) => {
      const x = await c.entry(e);
      return {
        id: Number(e),
        payer: x.payer as bigint,
        amount: x.amount as bigint,
        shareBits: Number(x.shareBits),
        what: x.what as string,
        at: Number(x.at),
      };
    }),
  );
  return { id, name: m.name, unit: m.unit, members: m.members as bigint[], opener: m.mask as bigint, entries };
}

export async function allTabs(limit = 20): Promise<Tab[]> {
  const n = await tabCount();
  const ids: number[] = [];
  for (let i = n - 1; i >= 0 && ids.length < limit; i -= 1) ids.push(i);
  return Promise.all(ids.map(readTab));
}

/**
 * Net position per member, in the smallest unit.
 *
 * A share is the amount divided by however many people it was split between,
 * and the remainder goes to the payer rather than vanishing: somebody has to
 * carry the odd cent, and the person who already put the money down is the least
 * unfair place to put it.
 */
export function balances(tab: Tab): Map<string, bigint> {
  const net = new Map<string, bigint>();
  const add = (k: string, v: bigint) => net.set(k, (net.get(k) ?? 0n) + v);
  for (const m of tab.members) net.set(m.toString(), 0n);

  for (const e of tab.entries) {
    const idx: number[] = [];
    for (let i = 0; i < tab.members.length; i += 1) if ((e.shareBits >> i) & 1) idx.push(i);
    if (!idx.length) continue;

    const each = e.amount / BigInt(idx.length);
    const rest = e.amount - each * BigInt(idx.length);

    // everyone in the split owes their share
    for (const i of idx) add(tab.members[i].toString(), -each);
    // the odd unit goes to whoever already put the money down, so the debits
    // add up to exactly what was paid and the tab always sums to zero
    const payer = e.payer.toString();
    const carrier = idx.some((i) => tab.members[i].toString() === payer) ? payer : tab.members[idx[0]].toString();
    add(carrier, -rest);
    // and the payer is owed all of it back
    add(payer, e.amount);
  }
  return net;
}

/** The shortest list of payments that clears the tab: biggest debt pays the
 *  biggest credit, repeatedly. It is not optimal in general, and it is close
 *  enough that nobody has ever complained about the difference over dinner. */
export function settle(net: Map<string, bigint>): { from: string; to: string; amount: bigint }[] {
  const owe = [...net.entries()].filter(([, v]) => v < 0n).map(([k, v]) => ({ k, v: -v }));
  const due = [...net.entries()].filter(([, v]) => v > 0n).map(([k, v]) => ({ k, v }));
  owe.sort((a, b) => (b.v > a.v ? 1 : -1));
  due.sort((a, b) => (b.v > a.v ? 1 : -1));
  const out: { from: string; to: string; amount: bigint }[] = [];
  let i = 0, j = 0;
  while (i < owe.length && j < due.length) {
    const amount = owe[i].v < due[j].v ? owe[i].v : due[j].v;
    if (amount > 0n) out.push({ from: owe[i].k, to: due[j].k, amount });
    owe[i].v -= amount;
    due[j].v -= amount;
    if (owe[i].v === 0n) i += 1;
    if (due[j].v === 0n) j += 1;
  }
  return out;
}

export const money = (v: bigint) => (Number(v) / 100).toFixed(2);

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
