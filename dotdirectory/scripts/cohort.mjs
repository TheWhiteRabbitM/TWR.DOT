/**
 * The ecosystem counted by PEOPLE rather than by names.
 *
 * 210 names is a flattering number and a nearly useless one: one address holds
 * 39 of them. The question worth asking of a chain whose developer population
 * runs to PBA cohorts is not how many names exist but how many distinct people
 * ever showed up, how many of those got past registering a name, and how many
 * came back a second week.
 *
 * Everything here is read from the directory contract and the content resolver.
 * "Deployed" means the resolver holds a non-empty contenthash for the name —
 * something is actually served at it. "Described" means a manifest record
 * exists.
 */
import { Contract, JsonRpcProvider, keccak256, solidityPacked, toUtf8Bytes, ZeroHash } from 'ethers';

const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io'];
const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';
const RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

const DOT = keccak256(solidityPacked(['bytes32', 'bytes32'], [ZeroHash, keccak256(toUtf8Bytes('dot'))]));
const nodeOf = (l) => keccak256(solidityPacked(['bytes32', 'bytes32'], [DOT, keccak256(toUtf8Bytes(l))]));

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
const res = new Contract(
  RESOLVER,
  ['function contenthash(bytes32) view returns (bytes)', 'function text(bytes32,string) view returns (string)'],
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
        entries.push({ label: e.label, owner: e.owner.toLowerCase(), block: Number(e.firstSeenBlock) });
      }
      start += page.length;
      break;
    } catch {
      size = Math.floor(size / 2);
      if (size < 1) throw new Error(`page read failed at ${start}`);
    }
  }
}

// Arrival dates from real header timestamps, and records per name.
const blocks = [...new Set(entries.map((e) => e.block).filter(Boolean))];
const times = new Map();
for (let i = 0; i < blocks.length; i += 60) {
  const s = blocks.slice(i, i + 60);
  const got = await Promise.all(s.map((b) => provider.getBlock(b).catch(() => null)));
  s.forEach((b, j) => got[j] && times.set(b, new Date(Number(got[j].timestamp) * 1000)));
}
for (let i = 0; i < entries.length; i += 40) {
  const s = entries.slice(i, i + 40);
  const got = await Promise.all(
    s.map(async (e) => {
      const node = nodeOf(e.label);
      const [hash, manifest] = await Promise.all([
        res.contenthash(node).catch(() => '0x'),
        res.text(node, 'manifest').catch(() => ''),
      ]);
      return { deployed: hash && hash !== '0x' && hash !== '0x00', described: Boolean(String(manifest).trim()) };
    }),
  );
  s.forEach((e, j) => Object.assign(e, got[j]));
}

const dated = entries.filter((e) => times.has(e.block)).map((e) => ({ ...e, at: times.get(e.block) }));
dated.sort((a, b) => a.at - b.at);
const t0 = dated[0].at.getTime();
const week = (d) => Math.floor((d.getTime() - t0) / (7 * 86400_000)) + 1;
const maxWeek = Math.max(...dated.map((e) => week(e.at)));

/* ------------------------------------------------------------- people ---- */

const people = new Map();
for (const e of dated) {
  const p = people.get(e.owner) ?? { names: 0, deployed: 0, described: 0, weeks: new Set() };
  p.names += 1;
  if (e.deployed) p.deployed += 1;
  if (e.described) p.described += 1;
  p.weeks.add(week(e.at));
  people.set(e.owner, p);
}
const all = [...people.values()];

const shipped = all.filter((p) => p.deployed > 0);
const describedAny = all.filter((p) => p.described > 0);
const oneAndDone = all.filter((p) => p.names === 1);
const oneAndNothing = all.filter((p) => p.names === 1 && p.deployed === 0);
const returned = all.filter((p) => p.weeks.size > 1);

const pct = (n) => `${((n / all.length) * 100).toFixed(0)}%`;

console.log(`${dated.length} names · ${all.length} distinct addresses\n`);
console.log(`addresses that ever deployed anything      ${shipped.length}  (${pct(shipped.length)})`);
console.log(`addresses that never deployed anything     ${all.length - shipped.length}  (${pct(all.length - shipped.length)})`);
console.log(`addresses that ever wrote a description    ${describedAny.length}  (${pct(describedAny.length)})`);
console.log(`addresses holding exactly one name         ${oneAndDone.length}  (${pct(oneAndDone.length)})`);
console.log(`  …of which never deployed anything        ${oneAndNothing.length}  (${pct(oneAndNothing.length)})`);
console.log(`addresses active in more than one week     ${returned.length}  (${pct(returned.length)})`);

/* Retention: of the addresses that first appeared in week N, how many were
   still registering anything later? This is the question a cohort answers. */
console.log('\nfirst week seen → came back at all');
const firstWeekOf = new Map();
for (const e of dated) {
  const w = week(e.at);
  const cur = firstWeekOf.get(e.owner);
  if (cur === undefined || w < cur) firstWeekOf.set(e.owner, w);
}
for (let w = 1; w <= maxWeek; w++) {
  const cohort = [...firstWeekOf].filter(([, fw]) => fw === w).map(([o]) => o);
  const back = cohort.filter((o) => [...people.get(o).weeks].some((x) => x > w));
  console.log(
    `  week ${w}: ${String(cohort.length).padStart(3)} new addresses · ${back.length} registered again later (${cohort.length ? Math.round((back.length / cohort.length) * 100) : 0}%)`,
  );
}

/* Concentration, because an average over 82 addresses hides one holding 39. */
const sorted = all.map((p) => p.names).sort((a, b) => b - a);
const share = (n) => `${((sorted.slice(0, n).reduce((a, b) => a + b, 0) / dated.length) * 100).toFixed(0)}%`;
console.log(`\nnames held by the top 1 / 3 / 10 addresses: ${share(1)} / ${share(3)} / ${share(10)}`);
console.log(`median names per address: ${sorted[Math.floor(sorted.length / 2)]}`);

const solo = all.filter((p) => p.names === 1 && p.deployed === 1);
console.log(
  `\naddresses that registered exactly one name and shipped it: ${solo.length} (${pct(solo.length)})`,
);
