/**
 * Discovery pass: scan a recent block window and tally which contracts emit
 * events, so we know exactly what a .dot registration looks like on-chain.
 *
 *   node discover.mjs [blocks]
 */
import { ApiPromise, WsProvider } from '@polkadot/api';

const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const WINDOW = Number(process.argv[2] ?? 3000);
const CONCURRENCY = 25;

setTimeout(() => { console.error('deadline'); process.exit(1); }, 600_000).unref();

const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
const latest = (await api.rpc.chain.getHeader()).number.toNumber();
const from = latest - WINDOW;
console.log(`scanning ${from} … ${latest} (${WINDOW} blocks)\n`);

const byContract = new Map();
const bySection = new Map();
let scanned = 0;

async function scanBlock(n) {
  try {
    const hash = await api.rpc.chain.getBlockHash(n);
    const at = await api.at(hash);
    const events = await at.query.system.events();
    for (const record of events) {
      const key = `${record.event.section}.${record.event.method}`;
      bySection.set(key, (bySection.get(key) ?? 0) + 1);
      if (key === 'revive.ContractEmitted') {
        const data = record.event.data.toJSON();
        const addr = String(data[0] ?? '').toLowerCase();
        if (!byContract.has(addr)) byContract.set(addr, { count: 0, sample: data, block: n });
        byContract.get(addr).count += 1;
      }
    }
  } catch {
    // skip unreachable block
  }
  scanned += 1;
}

const queue = [];
for (let n = from; n <= latest; n += 1) queue.push(n);
while (queue.length) {
  await Promise.all(queue.splice(0, CONCURRENCY).map(scanBlock));
  if (scanned % 500 === 0) process.stderr.write(`  …${scanned}\n`);
}

console.log('=== event kinds (top) ===');
[...bySection.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log('\n=== contracts emitting events ===');
[...byContract.entries()].sort((a, b) => b[1].count - a[1].count)
  .forEach(([addr, info]) => console.log(`  ${addr}  x${info.count}  (block ${info.block})`));

await api.disconnect();
process.exit(0);
