/**
 * Backfill the directory from what dotmetrics already found.
 *
 * The two indexes disagree by construction. dotmetrics walks blocks and reads
 * the plaintext label out of the raw registration calldata, so it sees every
 * name that was ever registered. DotDirectory2 learns a name only when somebody
 * proposes the exact string, because DotNS is namehash-keyed and the chain
 * cannot list itself. The result is a directory that trails the indexer by
 * however many names nobody happened to guess.
 *
 * This closes the gap: read dotmetrics' index, announce whatever is missing.
 * `announceMany` skips names that are already listed or no longer registered
 * rather than reverting, so a stale snapshot cannot fail the whole batch.
 *
 *   node scripts/sync-from-dotmetrics.mjs [--go]
 */
import { readFileSync } from 'node:fs';
import { Contract, JsonRpcProvider, Mnemonic, HDNodeWallet } from 'ethers';

const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';
const APPS = process.env.APPS_JSON ?? new URL('../../dotmetrics/indexer/apps.json', import.meta.url);
const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io'];
const GO = process.argv.includes('--go');
// The signer is whatever the caller supplies, falling back to the well-known dev
// phrase. Announcing is permissionless, so this needs no privilege beyond gas —
// and hdkd-helpers is deliberately not imported, because this script also runs
// from dotmetrics, which does not depend on it.
const PHRASE = process.env.MNEMONIC ?? 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
// Small on purpose. Each label costs an external REGISTRY.owner() call plus a
// storage write, and a batch of twenty-six made the gas estimator fail with no
// revert data at all rather than return a number. Five goes through.
const BATCH = 5;

const apps = JSON.parse(readFileSync(APPS, 'utf8'));
// apps.json carries one metadata key alongside the names; a label is a name
// only if it has an entry shaped like an app.
const labels = Object.entries(apps)
  .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.domain === 'string')
  .map(([k]) => k);

let p;
for (const u of RPCS) {
  try { const x = new JsonRpcProvider(u, undefined, { staticNetwork: true }); await x.getBlockNumber(); p = x; break; } catch {}
}
const abi = [
  'function isListed(string) view returns (bool)',
  'function count() view returns (uint256)',
  'function announceMany(string[] batch) returns (uint256 added)',
];
const read = new Contract(DIRECTORY, abi, p);

const before = Number(await read.count());
const missing = [];
for (let i = 0; i < labels.length; i += 20) {
  const chunk = labels.slice(i, i + 20);
  const res = await Promise.all(chunk.map((l) => read.isListed(l).catch(() => true)));
  res.forEach((listed, k) => { if (!listed) missing.push(chunk[k]); });
}

console.log(`dotmetrics knows ${labels.length} names, the directory holds ${before}`);
console.log(`missing: ${missing.length}${missing.length ? ` — ${missing.join(', ')}` : ''}`);
if (!missing.length) process.exit(0);
if (!GO) { console.log('\ndry run. pass --go to announce them.'); process.exit(0); }

const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(PHRASE)).connect(p);
const write = new Contract(DIRECTORY, abi, w);
for (let i = 0; i < missing.length; i += BATCH) {
  const chunk = missing.slice(i, i + BATCH);
  const rc = await (await write.announceMany(chunk, { gasLimit: 900_000_000n })).wait();
  console.log(`  announced ${chunk.length} (tx ${rc.hash})`);
}
const after = Number(await read.count());
console.log(`directory ${before} -> ${after}`);
