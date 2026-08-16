/**
 * A full sweep of the namespace, from the command line.
 *
 * The in-page sweep deliberately tests only ~700 candidates per visit, so it
 * stays a six-second background task and coverage accumulates across visitors.
 * This is the same idea without that budget: every dictionary word, every stem
 * compound, every affixed variant of every listed name, and the entire
 * three-letter space — which is finite (17,576) and therefore exhaustible in a
 * way the rest of the namespace is not.
 *
 * Discovery is by proposal, not enumeration: DotNS is namehash-keyed and its
 * events carry only the hash, so the chain cannot list its names — but
 * `owner(namehash(x))` answers for any x you invent, and that runs the question
 * backwards for free.
 *
 *   node scripts/discover.mjs             # everything
 *   node scripts/discover.mjs --no-short  # skip the 3-letter space
 */
import { Contract, JsonRpcProvider, keccak256, solidityPacked, toUtf8Bytes, ZeroHash } from 'ethers';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';
const REGISTRY = '0x527b08a640b527a3dae0C4BE04D7344E430B6E50';
const RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

const DOT = keccak256(solidityPacked(['bytes32', 'bytes32'], [ZeroHash, keccak256(toUtf8Bytes('dot'))]));
const nodeOf = (l) => keccak256(solidityPacked(['bytes32', 'bytes32'], [DOT, keccak256(toUtf8Bytes(l))]));

/* The word list and affix tables are the page's, read from source rather than
   duplicated — two copies of a dictionary drift, and then the command line and
   the page disagree about what has already been tried. */
const src = readFileSync(new URL('../src/sweep.ts', import.meta.url), 'utf8');
const slice = src.slice(src.indexOf('const WORDS'), src.indexOf('export interface Found'));
const { code } = await transform(slice.replace(/^export /gm, ''), { loader: 'ts' });
const { WORDS, SUFFIXES, PREFIXES, STEMS } = new Function(
  `${code}\nreturn { WORDS, SUFFIXES, PREFIXES, STEMS };`,
)();

let provider;
for (const rpc of RPCS) {
  try {
    const p = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 100, staticNetwork: true });
    await p.getBlockNumber();
    provider = p;
    console.log(`rpc: ${rpc}`);
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
const registry = new Contract(REGISTRY, ['function owner(bytes32) view returns (address)'], provider);
const resolver = new Contract(
  RESOLVER,
  ['function text(bytes32,string) view returns (string)', 'function contenthash(bytes32) view returns (bytes)'],
  provider,
);

// The listed set, read the same adaptive way the page reads it.
const total = Number(await dir.count());
const known = new Set();
for (let start = 0; start < total; ) {
  let size = 20;
  for (;;) {
    try {
      const page = await dir.pageDetailed(start, Math.min(size, total - start));
      for (const e of page) known.add(e.label);
      start += page.length;
      break;
    } catch {
      size = Math.floor(size / 2);
      if (size < 1) throw new Error(`page read failed at ${start}`);
    }
  }
}
console.log(`directory: ${known.size} names listed\n`);

/* ----------------------------------------------------------- candidates -- */

const LABEL_OK = /^[a-z0-9-]{3,32}$/;
const cands = new Set();
const add = (c) => {
  if (LABEL_OK.test(c) && !known.has(c)) cands.add(c);
};

for (const w of WORDS) {
  add(w);
  for (const s of STEMS) if (w !== s) add(s + w);
}
for (const base of known) {
  for (const s of SUFFIXES) add(base + s);
  for (const p of PREFIXES) add(p + base);
}
if (!process.argv.includes('--no-short')) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (const a of abc) for (const b of abc) for (const c of abc) add(a + b + c);
}

const list = [...cands];
console.log(`testing ${list.length} candidates…`);

/* --------------------------------------------------------------- sweep -- */

const CHUNK = 100;
const found = [];
const t0 = Date.now();
for (let i = 0; i < list.length; i += CHUNK) {
  const slice_ = list.slice(i, i + CHUNK);
  const owners = await Promise.all(slice_.map((c) => registry.owner(nodeOf(c)).catch(() => null)));
  slice_.forEach((label, j) => {
    const o = owners[j];
    if (o && !/^0x0+$/i.test(String(o))) found.push({ label, owner: String(o) });
  });
  if ((i / CHUNK) % 20 === 0 || i + CHUNK >= list.length) {
    const done = Math.min(i + CHUNK, list.length);
    const rate = Math.round(done / ((Date.now() - t0) / 1000));
    process.stdout.write(`\r  ${done}/${list.length} (${rate}/s) · ${found.length} found   `);
  }
}
console.log(`\n\nfound ${found.length} registered name(s) missing from the directory\n`);

/* What each one actually is, so the list is worth acting on rather than just long. */
for (const f of found) {
  const node = nodeOf(f.label);
  const [manifest, category, hash] = await Promise.all([
    resolver.text(node, 'manifest').catch(() => ''),
    resolver.text(node, 'category').catch(() => ''),
    resolver.contenthash(node).catch(() => '0x'),
  ]);
  const deployed = hash && hash !== '0x' && hash !== '0x00';
  let desc = '';
  try {
    desc = JSON.parse(manifest).description ?? '';
  } catch {
    /* a manifest that will not parse still means the name is described */
  }
  f.deployed = deployed;
  f.category = category || '';
  f.desc = desc;
}

// Deployed and described first: those are apps, the rest are parked names.
found.sort((a, b) => Number(b.deployed) - Number(a.deployed) || a.label.localeCompare(b.label));
for (const f of found) {
  console.log(
    `${f.deployed ? '● ' : '○ '}${f.label}.dot${f.category ? `  [${f.category}]` : ''}  ${f.owner.slice(0, 10)}…`,
  );
  if (f.desc) console.log(`    ${f.desc.slice(0, 100)}`);
}

const live = found.filter((f) => f.deployed);
console.log(`\n${live.length} of them have something deployed:`);
console.log(live.map((f) => f.label).join(' ') || '  (none)');
