/**
 * READ-ONLY probe of the Browse Publisher registry on the Products Devnet.
 *
 * Uses the devnet Ethereum JSON-RPC endpoint and plain eth_call to discover
 * which enumeration API the Publisher contract exposes, then reads the
 * published set. No signing, no key material, no state change.
 */
import { keccak_256 } from '@noble/hashes/sha3';

const RPC = process.env.ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const PUBLISHER = '0xaab42efbe8ea4d4228c3a11e973f94c17b9a0f2c';
// DotNS Registrar — resolves labelhash back to a human-readable label.
const REGISTRAR = '0x7f0dF075cc8B7FE7218E90fFC5a553450dB120F3';

const enc = new TextEncoder();
const hex = (b) => '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sel = (sig) => hex(keccak_256(enc.encode(sig)).slice(0, 4));
const labelhash = (l) => hex(keccak_256(enc.encode(l)));
const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');
const uint = (n) => BigInt(n).toString(16).padStart(64, '0');

let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  return r.json();
}

async function call(to, data) {
  const j = await rpc('eth_call', [{ to, data }, 'latest']);
  if (j.error) return { ok: false, err: j.error.message ?? JSON.stringify(j.error) };
  return { ok: true, data: j.result };
}

console.log('chainId:', (await rpc('eth_chainId', [])).result);
console.log('publisher code size:', (((await rpc('eth_getCode', [PUBLISHER, 'latest'])).result) ?? '0x').length);

console.log('\n=== no-arg view probe ===');
for (const sig of [
  'publishedCount()', 'totalPublished()', 'count()', 'total()', 'length()',
  'getPublished()', 'getAllPublished()', 'allPublished()', 'publishedLabels()',
  'getPublishedLabels()', 'labels()', 'list()', 'published()',
]) {
  const r = await call(PUBLISHER, sel(sig));
  const shown = r.ok ? (r.data === '0x' ? '0x (empty)' : r.data.slice(0, 260)) : `revert/err: ${r.err.slice(0, 70)}`;
  console.log(`${r.ok && r.data !== '0x' ? 'OK  ' : '--  '} ${sig.padEnd(22)} ${shown}`);
}

console.log('\n=== indexed probe (arg 0) ===');
for (const sig of ['publishedAt(uint256)', 'labelAt(uint256)', 'at(uint256)', 'getPublished(uint256)']) {
  const r = await call(PUBLISHER, sel(sig) + uint(0));
  console.log(`${r.ok && r.data !== '0x' ? 'OK  ' : '--  '} ${sig.padEnd(22)} ${r.ok ? r.data.slice(0, 200) : r.err.slice(0, 70)}`);
}

console.log('\n=== paginated probe (0,100) ===');
for (const sig of ['getPublished(uint256,uint256)', 'published(uint256,uint256)']) {
  const r = await call(PUBLISHER, sel(sig) + uint(0) + uint(100));
  console.log(`${r.ok && r.data !== '0x' ? 'OK  ' : '--  '} ${sig.padEnd(30)} ${r.ok ? r.data.slice(0, 400) : r.err.slice(0, 70)}`);
}

console.log('\n=== isPublished(bytes32) ===');
const labels = ['playground', 'browse', 'search', 'thebutton', 'dotmetrics', 'truereviews', 'openpetition', 'italiarovente', 'wudcommunity', 'discreet'];
for (const l of labels) {
  const r = await call(PUBLISHER, sel('isPublished(bytes32)') + pad(labelhash(l)));
  console.log(`${l.padEnd(15)} ${r.ok ? (BigInt(r.data || '0x0') === 1n ? 'PUBLISHED' : 'not published') : 'ERR ' + r.err.slice(0, 50)}`);
}

console.log('\n=== getPublished(bytes32[]) ===');
{
  const arr = ['thebutton', 'playground'].map((l) => pad(labelhash(l)));
  const r = await call(PUBLISHER, sel('getPublished(bytes32[])') + uint(0x20) + uint(arr.length) + arr.join(''));
  console.log(r.ok ? r.data.slice(0, 400) : 'ERR ' + r.err.slice(0, 80));
}

console.log('\n=== Publisher event log scan (full history) ===');
{
  const j = await rpc('eth_getLogs', [{ address: PUBLISHER, fromBlock: '0x0', toBlock: 'latest' }]);
  if (j.error) console.log('eth_getLogs err:', j.error.message);
  else {
    console.log(`total logs emitted by Publisher: ${j.result.length}`);
    const topics = {};
    for (const log of j.result) topics[log.topics[0]] = (topics[log.topics[0]] ?? 0) + 1;
    console.log('topic0 histogram:', topics);
    console.log('Published(bytes32,address,uint64) topic0 =', hex(keccak_256(enc.encode('Published(bytes32,address,uint64)'))));
    for (const log of j.result.slice(0, 40)) {
      console.log(`  blk ${parseInt(log.blockNumber, 16)} topics=${JSON.stringify(log.topics)} data=${log.data.slice(0, 100)}`);
    }
  }
}
