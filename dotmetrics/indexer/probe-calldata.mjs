/**
 * Registration events carry only the namehash; the plaintext label lives in the
 * transaction calldata. Historical extrinsics can't be decoded with current
 * metadata (runtime upgrades change call indices), so read the RAW block over
 * JSON-RPC and scan the bytes for ascii — no metadata needed.
 */
import { ApiPromise, WsProvider } from '@polkadot/api';

const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const BLOCKS = (process.argv[2] ?? '11350580,11349460,11352600').split(',').map(Number);

setTimeout(() => { console.error('deadline'); process.exit(1); }, 180_000).unref();

const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });

function asciiRuns(hex, min = 3) {
  const out = [];
  const buf = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  let cur = '';
  for (const b of buf) {
    if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b);
    else {
      if (cur.length >= min) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

for (const n of BLOCKS) {
  const hash = (await api.rpc.chain.getBlockHash(n)).toHex();
  // Raw JSON-RPC: no metadata decoding involved.
  const raw = await api._rpcCore.provider.send('chain_getBlock', [hash]);
  const extrinsics = raw?.block?.extrinsics ?? [];
  console.log(`\n=== block ${n} (${extrinsics.length} extrinsics) ===`);

  extrinsics.forEach((ex, i) => {
    const runs = asciiRuns(ex).filter((s) => /^[a-z0-9][a-z0-9.-]{2,40}$/i.test(s));
    if (runs.length) console.log(`  [${i}] len=${ex.length}  ascii: ${runs.slice(0, 8).join(' | ')}`);
  });
}

await api.disconnect();
process.exit(0);
