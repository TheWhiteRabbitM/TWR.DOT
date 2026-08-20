/**
 * When the .dot ecosystem actually got built.
 *
 * `firstSeenBlock` is the real arrival, not the migration: `announceManyDated`
 * accepts the true block for a name whose history predates this contract, and
 * refuses to overwrite one already recorded or to accept a future one. The
 * values for the backfilled names came from dotmetrics' block scan, so they are
 * when the registration transaction landed — with the honest caveat that a name
 * dotmetrics never saw would not be here to be counted.
 *
 * Block numbers are turned into dates by reading each block's own header
 * timestamp rather than by assuming a block time, because a six-second average
 * across two months compounds into days of error at the edges.
 */
import { Contract, JsonRpcProvider } from 'ethers';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
];
const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';

let provider;
for (const rpc of RPCS) {
  try {
    const p = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 60, staticNetwork: true });
    await p.getBlockNumber();
    provider = p;
    break;
  } catch {
    /* next */
  }
}
if (!provider) throw new Error('no rpc answered');

const dir = new Contract(
  DIRECTORY,
  [
    'function count() view returns (uint256)',
    'function pageDetailed(uint256,uint256) view returns (tuple(string label, address owner, uint64 firstSeenBlock)[])',
  ],
  provider,
);

const total = Number(await dir.count());
const entries = [];
for (let start = 0; start < total; ) {
  let size = 20;
  for (;;) {
    try {
      const page = await dir.pageDetailed(start, Math.min(size, total - start));
      for (const e of page) {
        entries.push({ label: e.label, owner: e.owner, block: Number(e.firstSeenBlock) });
      }
      start += page.length;
      break;
    } catch {
      size = Math.floor(size / 2);
      if (size < 1) throw new Error(`page read failed at ${start}`);
    }
  }
}
console.log(`${entries.length} names\n`);

// Header timestamps for every distinct arrival block, fired together so ethers
// batches them.
const blocks = [...new Set(entries.map((e) => e.block).filter((b) => b > 0))];
const times = new Map();
const CH = 60;
for (let i = 0; i < blocks.length; i += CH) {
  const slice = blocks.slice(i, i + CH);
  const got = await Promise.all(slice.map((b) => provider.getBlock(b).catch(() => null)));
  slice.forEach((b, j) => got[j] && times.set(b, new Date(Number(got[j].timestamp) * 1000)));
}

const dated = entries
  .map((e) => ({ ...e, at: times.get(e.block) ?? null }))
  .filter((e) => e.at)
  .sort((a, b) => a.at - b.at);
console.log(`${dated.length} of them have a readable arrival date`);
console.log(`first: ${dated[0].label} on ${dated[0].at.toISOString().slice(0, 10)}`);
console.log(`last:  ${dated.at(-1).label} on ${dated.at(-1).at.toISOString().slice(0, 10)}\n`);

/* Weeks measured from the first arrival, so week 1 is the ecosystem's week 1
   rather than an arbitrary Monday. */
const t0 = dated[0].at.getTime();
const week = (d) => Math.floor((d.getTime() - t0) / (7 * 86400_000)) + 1;
const byWeek = new Map();
for (const e of dated) byWeek.set(week(e.at), (byWeek.get(week(e.at)) ?? 0) + 1);

const maxWeek = Math.max(...byWeek.keys());
const peak = Math.max(...byWeek.values());
console.log('week   from         names  ');
let running = 0;
for (let w = 1; w <= maxWeek; w++) {
  const n = byWeek.get(w) ?? 0;
  running += n;
  const from = new Date(t0 + (w - 1) * 7 * 86400_000).toISOString().slice(0, 10);
  const bar = '█'.repeat(Math.round((n / peak) * 40));
  console.log(`${String(w).padStart(4)}   ${from}  ${String(n).padStart(4)}  ${bar}`);
}

/* Distinct owners per week says something the name count cannot: whether the
   growth was more builders or the same builders shipping more. */
console.log('\nweek   names  distinct owners  new owners');
const seenOwners = new Set();
for (let w = 1; w <= maxWeek; w++) {
  const inWeek = dated.filter((e) => week(e.at) === w);
  const owners = new Set(inWeek.map((e) => e.owner.toLowerCase()));
  const fresh = [...owners].filter((o) => !seenOwners.has(o));
  fresh.forEach((o) => seenOwners.add(o));
  console.log(
    `${String(w).padStart(4)}  ${String(inWeek.length).padStart(5)}  ${String(owners.size).padStart(15)}  ${String(fresh.length).padStart(10)}`,
  );
}

const half = Math.ceil(maxWeek / 2);
const firstHalf = dated.filter((e) => week(e.at) <= half).length;
const secondHalf = dated.length - firstHalf;
console.log(
  `\nfirst ${half} week(s): ${firstHalf} names · last ${maxWeek - half}: ${secondHalf} · ` +
    `total owners ${seenOwners.size}`,
);

const top = [...dated.reduce((m, e) => m.set(e.owner, (m.get(e.owner) ?? 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
console.log('\nbiggest holders:');
for (const [owner, n] of top) {
  console.log(`  ${owner.slice(0, 12)}…  ${n} names  (${((n / dated.length) * 100).toFixed(1)}%)`);
}
