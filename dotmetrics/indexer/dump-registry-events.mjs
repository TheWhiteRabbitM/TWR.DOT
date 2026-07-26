/**
 * Dump the DotNS registry's ContractEmitted payloads so we can decode what a
 * registration actually looks like (topics + data).
 */
import { ApiPromise, WsProvider } from '@polkadot/api';

const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const REGISTRY = '0x527b08a640b527a3dae0c4be04d7344e430b6e50';
const WINDOW = Number(process.argv[2] ?? 6000);
const CONCURRENCY = 25;

setTimeout(() => { console.error('deadline'); process.exit(1); }, 900_000).unref();

const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
const latest = (await api.rpc.chain.getHeader()).number.toNumber();
const from = latest - WINDOW;
console.log(`scanning ${from} … ${latest} for ${REGISTRY}\n`);

const utf8 = (hex) => {
  try {
    const b = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
    return b.toString('utf8').replace(/[^\x20-\x7e]/g, '·');
  } catch {
    return '';
  }
};

const found = [];

async function scan(n) {
  try {
    const hash = await api.rpc.chain.getBlockHash(n);
    const at = await api.at(hash);
    const events = await at.query.system.events();
    for (const rec of events) {
      if (`${rec.event.section}.${rec.event.method}` !== 'revive.ContractEmitted') continue;
      const d = rec.event.data.toJSON();
      const addr = String(d[0] ?? '').toLowerCase();
      if (addr !== REGISTRY) continue;
      found.push({ block: n, data: d });
    }
  } catch {
    /* skip */
  }
}

const queue = [];
for (let n = from; n <= latest; n += 1) queue.push(n);
while (queue.length) await Promise.all(queue.splice(0, CONCURRENCY).map(scan));

console.log(`registry events found: ${found.length}\n`);
for (const f of found.slice(0, 12)) {
  console.log(`--- block ${f.block} ---`);
  console.log(JSON.stringify(f.data, null, 1).slice(0, 700));
  // Try to surface any readable label inside the payload.
  const flat = JSON.stringify(f.data);
  for (const m of flat.match(/0x[0-9a-f]{16,}/gi) ?? []) {
    const s = utf8(m);
    if (/[a-z]{4,}/i.test(s)) console.log(`   utf8-ish: ${s.slice(0, 80)}`);
  }
  console.log();
}

await api.disconnect();
process.exit(0);
