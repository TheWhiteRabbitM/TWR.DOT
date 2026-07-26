/**
 * READ-ONLY: enumerate the full Browse directory on the Products Devnet and
 * resolve each labelhash back to its .dot label.
 *
 * Publisher.getPublished(offset, limit) -> bytes32[] labelhashes.
 * Reverse-resolution is attempted via the DotNS Registrar; whatever the
 * Registrar cannot answer is matched against a candidate dictionary by
 * keccak256, which is exactly what a client-side "search" would have to do.
 */
import { keccak_256 } from '@noble/hashes/sha3';

const RPC = process.env.ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const PUBLISHER = '0xaab42efbe8ea4d4228c3a11e973f94c17b9a0f2c';
const REGISTRAR = '0x7f0dF075cc8B7FE7218E90fFC5a553450dB120F3';
const DOTNS_REGISTRY = '0x527b08a640b527a3dae0C4BE04D7344E430B6E50';

const enc = new TextEncoder();
const hx = (b) => '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sel = (s) => hx(keccak_256(enc.encode(s)).slice(0, 4));
const lh = (l) => hx(keccak_256(enc.encode(l)));
const uint = (n) => BigInt(n).toString(16).padStart(64, '0');
const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');

let id = 0;
const rpc = async (m, p) =>
  (await (await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: m, params: p }),
  })).json());

async function call(to, data) {
  const j = await rpc('eth_call', [{ to, data }, 'latest']);
  return j.error ? { ok: false, err: j.error.message ?? '' } : { ok: true, data: j.result };
}

// --- 1. enumerate ---
const cnt = await call(PUBLISHER, sel('publishedCount()'));
const total = Number(BigInt(cnt.data));
console.log(`publishedCount() = ${total}\n`);

const r = await call(PUBLISHER, sel('getPublished(uint256,uint256)') + uint(0) + uint(total));
const body = r.data.slice(2);
const len = Number(BigInt('0x' + body.slice(64, 128)));
const hashes = [];
for (let i = 0; i < len; i++) hashes.push('0x' + body.slice(128 + i * 64, 128 + (i + 1) * 64));
console.log(`getPublished(0, ${total}) returned ${len} labelhashes\n`);

// --- 2. try on-chain reverse resolution ---
console.log('=== Registrar reverse-resolution probe ===');
const revSigs = ['labelOf(bytes32)', 'nameOf(bytes32)', 'labelFor(bytes32)', 'label(bytes32)', 'names(bytes32)', 'labelOf(uint256)'];
let working = null;
for (const sig of revSigs) {
  for (const target of [REGISTRAR, DOTNS_REGISTRY]) {
    const res = await call(target, sel(sig) + pad(hashes[0]));
    if (res.ok && res.data && res.data !== '0x') {
      console.log(`OK  ${sig} @ ${target} -> ${res.data.slice(0, 200)}`);
      if (!working) working = { sig, target };
    }
  }
}
if (!working) console.log('none of the probed reverse-resolution selectors returned data');

// --- 3. dictionary attack: the only way a client can label these today ---
const dict = [
  'playground', 'browse', 'search', 'apps', 'store', 'chat', 'wallet', 'pocket',
  'thebutton', 'dotmetrics', 'truereviews', 'openpetition', 'italiarovente',
  'wudcommunity', 'discreet', 'handshake', 'survey', 'simplesurvey', 'todo',
  'sharedtodo', 'demo', 'demoapp', 'example', 'test', 'testapp', 'hello',
  'helloworld', 'notes', 'poll', 'polls', 'vote', 'voting', 'calendar', 'clock',
  'weather', 'news', 'music', 'photos', 'gallery', 'games', 'game', 'snake',
  'chess', 'tictactoe', 'paint', 'draw', 'canvas', 'board', 'forum', 'blog',
  'shop', 'market', 'marketplace', 'swap', 'dex', 'bridge', 'stake', 'staking',
  'governance', 'treasury', 'faucet', 'explorer', 'identity', 'profile',
  'friends', 'social', 'feed', 'timeline', 'events', 'tickets', 'booking',
  'reviews', 'ratings', 'maps', 'travel', 'food', 'recipes', 'fitness',
  'health', 'finance', 'budget', 'invoice', 'crowdfund', 'donate', 'charity',
  'petition', 'signup', 'auth', 'login', 'docs', 'wiki', 'help', 'support',
  'counter', 'timer', 'stopwatch', 'dice', 'random', 'lottery', 'raffle',
  'auction', 'bid', 'nft', 'mint', 'token', 'coin', 'cash', 'pay', 'send',
  'split', 'tip', 'jar', 'piggy', 'bank', 'ledger', 'accounts', 'contacts',
  'messages', 'mail', 'inbox', 'radio', 'podcast', 'video', 'stream', 'live',
  'watch', 'read', 'books', 'library', 'quiz', 'trivia', 'flashcards', 'learn',
  'school', 'class', 'course', 'homework', 'grades', 'attendance', 'roster',
];
const byHash = new Map(dict.map((w) => [lh(w), w]));

console.log('\n=== the 19 published labels ===');
const unknown = [];
hashes.forEach((h, i) => {
  const name = byHash.get(h);
  if (name) console.log(`${String(i + 1).padStart(2)}. ${name}.dot`);
  else { console.log(`${String(i + 1).padStart(2)}. <unresolved> ${h}`); unknown.push(h); }
});
console.log(`\nresolved ${len - unknown.length}/${len} by dictionary; ${unknown.length} unresolved`);
