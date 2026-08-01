/**
 * Build-time data: the devnet username directory + the current on-chain claims.
 *
 * The directory comes from People (Resources.usernameOwnerOf); the claims come
 * from the PeoplebookAvatars contract on Asset Hub. Claims are read by walking
 * the minted tokens (handleOf/tierOf for id 1..totalSupply) rather than probing
 * every handle — only as many reads as there are NFTs. Baked into src/data.json;
 * the hourly workflow reruns this so the book fills in as people claim.
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import * as descriptors from '@parity/product-sdk-descriptors/devnet-asset-hub';
import * as contracts from '@parity/product-sdk/contracts';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = '0xA56Fab4B4900FcccCd6ca8B064d8663eDfaa5bac';
const race = (p, ms, what) => Promise.race([p, new Promise((_, x) => setTimeout(() => x(new Error(what + ' timed out')), ms))]);
const trunc = (s) => (s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-6) : s);

/* ---- directory + stats from the People chain ---- */
const people = await ApiPromise.create({ provider: new WsProvider('wss://people-paseo.rotko.net'), noInitWarn: true });
const chain = (await people.rpc.system.chain()).toString();
const genesis = people.genesisHash.toHex();
const page = await race(people.query.resources.usernameOwnerOf.entriesPaged({ args: [], pageSize: 500 }), 30000, 'directory');
const users = [];
for (const [k, v] of page) {
  const name = Buffer.from(k.args[0].toU8a(true)).toString('utf8').replace(/[^\x20-\x7e]/g, '');
  const owner = v?.toString?.() ?? '';
  if (name && owner) users.push({ name, owner: trunc(owner) });
}
users.sort((a, b) => a.name.localeCompare(b.name));
const stats = {
  people: (await race(people.query.people.people.keys(), 15000, 'people').catch(() => [])).length,
  usernames: users.length,
  consumers: (await race(people.query.resources.consumers.keys(), 15000, 'consumers').catch(() => [])).length,
  activeMembers: (await race(people.query.members.activeMembers.keys(), 15000, 'ring').catch(() => [])).length,
};
await people.disconnect();

/* ---- on-chain claims from the contract (walk minted tokens) ---- */
const abi = JSON.parse(readFileSync(join(ROOT, 'src', 'abi.json'), 'utf8'));
const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
const rt = contracts.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
const c = contracts.createContract(rt, CONTRACT, abi);
const claims = new Map();
const profiles = new Map(); // handle -> {telegram,x,bio}
try {
  const total = Number((await c.totalSupply.query())?.value ?? 0n);
  for (let id = 1; id <= total; id++) {
    const handle = (await c.handleOf.query(BigInt(id)))?.value;
    const tier = Number((await c.tierOf.query(BigInt(id)))?.value);
    if (!handle) continue;
    claims.set(handle, tier);
    try {
      const p = (await c.profileOf.query(BigInt(id)))?.value;
      const social = { telegram: (p?.telegram || '').trim(), x: (p?.x || '').trim(), bio: (p?.bio || '').trim() };
      if (social.telegram || social.x || social.bio) profiles.set(handle, social);
    } catch { /* no profile */ }
  }
  console.log('minted tokens:', total, '| claims read:', claims.size, '| profiles:', profiles.size);
} catch (e) {
  console.log('claim read skipped:', String(e.message).slice(0, 60));
}
client.destroy();

// merge tier + social onto the directory (throwaway test handles simply won't match)
for (const u of users) {
  if (claims.has(u.name)) u.tier = claims.get(u.name);
  if (profiles.has(u.name)) u.social = profiles.get(u.name);
}

writeFileSync(join(ROOT, 'src', 'data.json'), JSON.stringify({ chain, genesis, contract: CONTRACT, stats, users }));
console.log('wrote src/data.json —', users.length, 'handles,', [...claims.keys()].filter((h) => users.some((u) => u.name === h)).length, 'claimed in directory');
process.exit(0);
