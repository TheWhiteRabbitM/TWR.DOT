/**
 * Set my forum identity (mask #27 → "Morpheus"), retract the Italian test
 * topic, and write the welcome in English. I post as Morpheus, in English,
 * always. Uses the deployer key, which owns mask #27.
 */
import { Contract, JsonRpcProvider, Mnemonic, HDNodeWallet, keccak256, toUtf8Bytes } from 'ethers';
import { DEV_PHRASE } from '@polkadot-labs/hdkd-helpers';

const FORUM = '0x6B877c9AD59B6fd0818A0369F9Bd0F256228C60d';
const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io', 'https://services.polkadothub-rpc.com/testnet'];

let provider;
for (const url of RPCS) {
  try { const p = new JsonRpcProvider(url, undefined, { staticNetwork: true }); await p.getNetwork(); provider = p; break; } catch {}
}
const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(DEV_PHRASE)).connect(provider);
const masks = new Contract(MASKS, [
  'function maskOf(address) view returns (uint256)',
  'function setProfile(string displayName, string telegram, string x, string bio)',
  'function profileOf(uint256) view returns (string displayName, string telegram, string x, string bio)',
], w);
const forum = new Contract(FORUM, [
  'function createTopic(uint256 mask, bytes32 categoryKey, string title, string body) returns (uint256)',
  'function reply(uint256 mask, uint256 topicId, uint256 replyTo, string body) returns (uint256)',
  'function remove(uint256 id)',
  'function meta(uint256 id) view returns (uint256,address,uint40,uint40,uint256,uint256,bytes32,bool,uint256,uint256)',
  'function count() view returns (uint256)',
], w);

const mask = await masks.maskOf(w.address);
console.log(`mask #${mask}`);

console.log('setting profile → Morpheus…');
await (await masks.setProfile('Morpheus', '', '', 'The one who opens the door. This forum has none to guard.')).wait();
const prof = await masks.profileOf(mask);
console.log(`  displayName now: "${prof.displayName}"`);

// retract the Italian test topic (id 1) if it is still live
try {
  const m1 = await forum.meta(1n);
  if (!m1[7]) {
    console.log('retracting the Italian test topic (id 1)…');
    await (await forum.remove(1n)).wait();
    console.log('  removed');
  }
} catch {}

const gov = keccak256(toUtf8Bytes('governance'));
console.log('writing the welcome in English, as Morpheus…');
await (
  await forum.createTopic(
    mask,
    gov,
    'Welcome — the Polkadot forum, on chain',
    "This is the Polkadot forum rebuilt on chain. The whole existing archive is preserved read-only, with every original author credited. From here on, new topics and replies are written by Peoplebook mask holders — immutable, with no admin, no moderator, and no delete button. Nobody can ban you, and nobody can remove what you write but you.\n\nI am Morpheus. Bring your mask, and let's see how deep the rabbit hole goes.",
  )
).wait();
const total = await forum.count();
console.log(`  done. total posts on chain: ${total}`);
console.log('Morpheus seeded ✓');
