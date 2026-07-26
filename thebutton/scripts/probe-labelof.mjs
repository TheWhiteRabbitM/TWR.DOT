/**
 * READ-ONLY: can the Browse client turn the registry's labelhashes back into
 * human-readable .dot labels? Tests Registrar.labelOf(uint256) against a known
 * label first, then against all 19 published labelhashes.
 */
import { keccak_256 } from '@noble/hashes/sha3';

const RPC = process.env.ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const PUBLISHER = '0xaab42efbe8ea4d4228c3a11e973f94c17b9a0f2c';
const REGISTRAR = '0x7f0dF075cc8B7FE7218E90fFC5a553450dB120F3';

const enc = new TextEncoder();
const hx = (b) => '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sel = (s) => hx(keccak_256(enc.encode(s)).slice(0, 4));
const lh = (l) => hx(keccak_256(enc.encode(l)));
const uint = (n) => BigInt(n).toString(16).padStart(64, '0');

let id = 0;
const rpc = async (m, p) =>
  (await (await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: m, params: p }),
  })).json());

async function call(to, data) {
  const j = await rpc('eth_call', [{ to, data }, 'latest']);
  return j.error ? { ok: false, err: j.error.message ?? '' } : { ok: true, data: j.result };
}

/** ABI-decode a single dynamic `string` return value. */
function decodeString(hexData) {
  if (!hexData || hexData === '0x') return null;
  const b = hexData.slice(2);
  const len = Number(BigInt('0x' + b.slice(64, 128)));
  if (len === 0) return '';
  const bytes = b.slice(128, 128 + len * 2).match(/../g).map((x) => parseInt(x, 16));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

console.log('=== control: labelOf on a label we KNOW is published (browse) ===');
for (const sig of ['labelOf(uint256)', 'labelOf(bytes32)']) {
  const r = await call(REGISTRAR, sel(sig) + uint(BigInt(lh('browse'))));
  console.log(`${sig.padEnd(18)} raw=${(r.data ?? r.err).slice(0, 80)} decoded=${JSON.stringify(r.ok ? decodeString(r.data) : null)}`);
}

console.log('\n=== all 19 published labelhashes via Registrar.labelOf(uint256) ===');
const total = Number(BigInt((await call(PUBLISHER, sel('publishedCount()'))).data));
const body = (await call(PUBLISHER, sel('getPublished(uint256,uint256)') + uint(0) + uint(total))).data.slice(2);
const len = Number(BigInt('0x' + body.slice(64, 128)));
let named = 0;
for (let i = 0; i < len; i++) {
  const h = '0x' + body.slice(128 + i * 64, 128 + (i + 1) * 64);
  const r = await call(REGISTRAR, sel('labelOf(uint256)') + uint(BigInt(h)));
  const s = r.ok ? decodeString(r.data) : null;
  if (s) named++;
  console.log(`${String(i + 1).padStart(2)}. ${s ? s + '.dot' : '(empty — not reverse-resolvable)'}   ${h.slice(0, 12)}…`);
}
console.log(`\n${named}/${len} labelhashes reverse-resolved to a name`);
