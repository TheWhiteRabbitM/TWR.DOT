// Enrich the app directory with the REAL wall-clock time of each registration.
//
// The growth chart needs time, not just block numbers. Rather than re-walk the
// whole chain, this reads the existing apps.json and queries `timestamp.now` at
// each distinct registration block — a few dozen point lookups — writing
// `firstSeenAt` (unix seconds) into every entry.
import { ApiPromise, WsProvider } from '@polkadot/api';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'apps.json');
const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';

const apps = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });

// Distinct blocks → timestamp, so repeated blocks cost one lookup.
const blocks = [...new Set(Object.values(apps).map((a) => a.firstSeenBlock).filter((b) => b > 0))];
console.log(`resolving timestamps for ${blocks.length} distinct blocks`);

const at = new Map();
for (const n of blocks) {
  const hash = await api.rpc.chain.getBlockHash(n);
  const ms = await api.query.timestamp.now.at(hash);
  at.set(n, Math.floor(Number(ms.toString()) / 1000));
}

let filled = 0;
for (const a of Object.values(apps)) {
  const ts = at.get(a.firstSeenBlock);
  if (ts) {
    a.firstSeenAt = ts;
    filled += 1;
  }
}

fs.writeFileSync(FILE, JSON.stringify(apps, null, 2) + '\n');
console.log(`wrote firstSeenAt for ${filled} apps → ${FILE}`);
await api.disconnect();
