/**
 * What the chain knows about a `.dot` name. Read-only, no wallet.
 *
 *   node scripts/whois.mjs polkashoot [more names…]
 */
import { Contract, JsonRpcProvider, keccak256, solidityPacked, toUtf8Bytes, ZeroHash } from 'ethers';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
];
const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';
const RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

const DOT = keccak256(solidityPacked(['bytes32', 'bytes32'], [ZeroHash, keccak256(toUtf8Bytes('dot'))]));
const nodeOf = (l) => keccak256(solidityPacked(['bytes32', 'bytes32'], [DOT, keccak256(toUtf8Bytes(l))]));

let provider;
for (const rpc of RPCS) {
  try {
    const p = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 20, staticNetwork: true });
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
    'function isListed(string) view returns (bool)',
    'function ownerOfLabel(string) view returns (address)',
    'function count() view returns (uint256)',
  ],
  provider,
);
const res = new Contract(
  RESOLVER,
  [
    'function text(bytes32,string) view returns (string)',
    'function contenthash(bytes32) view returns (bytes)',
  ],
  provider,
);

const names = process.argv.slice(2).map((s) => s.toLowerCase().replace(/\.dot$/, ''));
if (!names.length) throw new Error('usage: node scripts/whois.mjs <label> [...]');

console.log(`directory holds ${await dir.count()} names\n`);
for (const label of names) {
  const node = nodeOf(label);
  const [owner, listed, manifest, category, hash] = await Promise.all([
    dir.ownerOfLabel(label).catch(() => null),
    dir.isListed(label).catch(() => false),
    res.text(node, 'manifest').catch(() => ''),
    res.text(node, 'category').catch(() => ''),
    res.contenthash(node).catch(() => '0x'),
  ]);
  const held = owner && !/^0x0+$/i.test(String(owner));
  console.log(`${label}.dot`);
  console.log(`  registered:  ${held ? owner : 'NO — nobody owns this name'}`);
  if (!held) { console.log(''); continue; }
  console.log(`  in directory: ${listed ? 'yes' : 'NO — registered but never announced'}`);
  console.log(`  site deployed: ${hash && hash !== '0x' && hash !== '0x00' ? 'yes' : 'no'}`);
  console.log(`  category:    ${category || '—'}`);
  let desc = '—';
  try { desc = JSON.parse(manifest).description || '—'; } catch { desc = manifest ? '(unparseable manifest)' : '—'; }
  console.log(`  describes itself: ${desc}\n`);
}
