// Measure REAL ecosystem on-chain activity over a recent window and write a
// compact ecosystem.json the dashboard reads. Honest by construction: it reports
// only what it actually counted, over a stated window, at a stated time.
//
// Why a script and not a live browser read: activity lives in Substrate
// `revive.ContractEmitted` events (eth_getLogs returns nothing here), and full
// blocks don't decode with generic metadata — so it's a Node/@polkadot job, run
// periodically, same shape as the directory indexer.
import { ApiPromise, WsProvider } from '@polkadot/api';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'ecosystem.json');
const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const WINDOW = Number(process.env.WINDOW ?? 600);

const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
const head = (await api.rpc.chain.getHeader()).number.toNumber();
const from = Math.max(1, head - WINDOW);
console.log(`head #${head}; scanning ${from}..${head}`);

const contracts = new Map();
let contractEvents = 0;
let reverts = 0;
let scanned = 0;
let firstTs = null;
let lastTs = null;

for (let n = from; n <= head; n += 1) {
  const hash = await api.rpc.chain.getBlockHash(n);
  let events;
  try {
    events = await api.query.system.events.at(hash);
  } catch {
    continue;
  }
  scanned += 1;
  const ms = Number((await api.query.timestamp.now.at(hash)).toString());
  if (firstTs == null) firstTs = ms;
  lastTs = ms;
  for (const record of events) {
    const { section, method, data } = record.event;
    if (section === 'revive' && method === 'ContractEmitted') {
      contractEvents += 1;
      const addr = String(data[0]).toLowerCase();
      contracts.set(addr, (contracts.get(addr) ?? 0) + 1);
    } else if (section === 'revive' && method === 'EthExtrinsicRevert') {
      reverts += 1;
    }
  }
}

const spanSec = firstTs != null && lastTs != null ? Math.round((lastTs - firstTs) / 1000) : 0;
const out = {
  measuredAt: Math.floor((lastTs ?? Date.now()) / 1000),
  headBlock: head,
  windowBlocks: scanned,
  windowSeconds: spanSec,
  contractEvents,
  activeContracts: contracts.size,
  reverts,
  topContracts: [...contracts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([address, events]) => ({ address, events })),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// Append to the run history: one line per measurement. Each 6-hourly refresh
// adds a point, so the dashboard's activity-over-time chart builds itself.
const HISTORY = path.join(HERE, 'history.jsonl');
fs.appendFileSync(
  HISTORY,
  JSON.stringify({
    at: out.measuredAt,
    head: out.headBlock,
    events: out.contractEvents,
    reverts: out.reverts,
    contracts: out.activeContracts,
  }) + '\n',
);

console.log('wrote', OUT, out);
await api.disconnect();
