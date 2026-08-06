/**
 * The global check: do peoplebook, chirp and dotmail mean the same person by
 * the same address?
 */
import { readFileSync } from 'node:fs';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import * as descriptors from '@parity/product-sdk-descriptors/devnet-asset-hub';
import * as contracts from '@parity/product-sdk/contracts';

const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';   // chirp AND peoplebook
const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';
const DOTMAIL = '0x9e12df714fd4b581414753d07fee23e00f7e2bf3';

const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
const rt = contracts.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
const m = contracts.createContract(rt, MASKS, JSON.parse(readFileSync('src/masks-abi.json', 'utf8')), {});
const h = contracts.createContract(rt, HANDLES, JSON.parse(readFileSync('src/handles-abi.json', 'utf8')), {});
const d = contracts.createContract(rt, DOTMAIL, JSON.parse(readFileSync('../dotmail/src/dotmail-abi.json', 'utf8')), {});

const addr = (v) => String(v?.asHex?.() ?? v ?? '').toLowerCase();

console.log('mask  handle              owner                                       has dotmail key');
console.log('----  ------------------  ------------------------------------------  ---------------');

const owners = new Map();
let withHandle = 0, withKey = 0, total = 0;

for (let id = 1n; id <= 30n; id++) {
  const o = await m.ownerOf.query(id).catch(() => null);
  const a = addr(o?.value);
  if (!a || /^0x0+$/.test(a)) continue;
  total++;
  const hd = String((await h.handleOf.query(id).catch(() => null))?.value ?? '').trim();
  if (hd) withHandle++;
  owners.set(a, (owners.get(a) ?? []).concat(Number(id)));

  // Does that SAME address have a dotmail key?
  const k = await d.keyOf.query(a).catch(() => null);
  const key = String(k?.value?.asHex?.() ?? k?.value ?? '');
  const has = key && !/^0x0+$/.test(key);
  if (has) withKey++;
  console.log(`${String(id).padEnd(6)}${(hd || '-').padEnd(20)}${a.padEnd(44)}${has ? 'YES' : 'no'}`);
}

console.log(`\n${total} masks, ${withHandle} with a handle, ${withKey} whose owner has a dotmail key`);
console.log(`${owners.size} distinct owner addresses`);

const many = [...owners.entries()].filter(([, ids]) => ids.length > 1);
console.log(many.length
  ? `\n${many.length} addresses hold more than one mask: ${many.map(([a, ids]) => a.slice(0, 10) + '…(' + ids.join(',') + ')').join(' ')}`
  : '\nevery address holds at most one mask');

console.log(`\nVERDICT: ${withKey === 0
  ? 'NO mask owner has a dotmail key. dotmail keys are registered by a DIFFERENT account than the one that owns the mask, so the three apps do not agree on who anybody is.'
  : `${withKey} of ${total} mask owners are reachable by mail.`}`);

client.destroy();
process.exit(0);
