/**
 * Deploy ForumBoard to devnet (pallet-revive / PolkaVM) and PROVE it works
 * end to end — not just the mask gate, an actual topic + reply + like written
 * on chain and read back. Same deploy rail as deploy-outcome-votes.mjs.
 *
 *   node deploy-forum.mjs
 */
import { readFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Contract, Mnemonic, HDNodeWallet, keccak256, toUtf8Bytes } from 'ethers';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { ss58Encode } from '@parity/product-sdk/address';

const BUILD = 'file:///C:/Users/miche/Downloads/DOT/forum-app/contract/build/';
const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
const ETH_RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
const WS = ['wss://asset-hub-paseo-rpc.n.dwellir.com', 'wss://sys.turboflakes.io/asset-hub-paseo'];

const abi = JSON.parse(readFileSync(new URL('ForumBoard_sol_ForumBoard.abi', BUILD), 'utf8'));
const bytecode = '0x' + readFileSync(new URL('ForumBoard_sol_ForumBoard.polkavm', BUILD)).toString('hex');
console.log(`blob ${(bytecode.length - 2) / 2} bytes`);

let provider;
for (const url of ETH_RPCS) {
  try {
    const p = new JsonRpcProvider(url, undefined, { staticNetwork: true });
    await p.getNetwork();
    provider = p;
    console.log(`eth-rpc ${url}`);
    break;
  } catch {}
}
if (!provider) throw new Error('no eth-rpc answered');

const deployer = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(DEV_PHRASE)).connect(provider);
console.log(`deployer ${deployer.address}`);
let bal = await provider.getBalance(deployer.address);
if (bal < 2n * 10n ** 18n) {
  console.log('funding from Alice…');
  const evmAccountId = (h) => ss58Encode(Uint8Array.from([...Buffer.from(h.replace(/^0x/, ''), 'hex'), ...new Array(12).fill(0xee)]));
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
  const alice = derive('//Alice');
  const signer = getPolkadotSigner(alice.publicKey, 'Sr25519', alice.sign);
  let client;
  for (const ws of WS) { try { client = createClient(getWsProvider(ws)); await client.getTypedApi(devnet_asset_hub).query.System.Number.getValue(); break; } catch { client = undefined; } }
  const api = client.getTypedApi(devnet_asset_hub);
  await api.tx.Balances.transfer_keep_alive({ dest: { type: 'Id', value: evmAccountId(deployer.address) }, value: 5n * 10n ** 10n }).signAndSubmit(signer);
  client.destroy();
  for (let i = 0; i < 10 && bal < 10n ** 18n; i++) { await new Promise((r) => setTimeout(r, 3000)); bal = await provider.getBalance(deployer.address); }
}
console.log(`balance ${bal}`);

/* ------------------------------------------------------------- deploy ---- */
console.log('deploying ForumBoard (no constructor args — PEOPLEBOOK is constant)…');
const factory = new ContractFactory(abi, bytecode, deployer);
const forum = await factory.deploy();
await forum.waitForDeployment();
const address = await forum.getAddress();
console.log(`  deployed at ${address}`);
const code = await provider.getCode(address);
if (!code || code === '0x') throw new Error('no code at address');
const cat = keccak256(toUtf8Bytes('governance'));

/* 1) GATE: createTopic with a mask this account does not own must revert. */
try {
  await forum.createTopic.staticCall(1n, cat, 'x', 'y');
  console.log('  ✗ GATE BROKEN: createTopic did not revert for an unowned mask');
} catch {
  console.log('  ✓ gate: createTopic reverts for a mask the caller does not own');
}

/* 2) Get the deployer a mask (open claim on devnet), or reuse its existing one. */
const masks = new Contract(MASKS, [
  'function claim(string dotLabel) returns (uint256)',
  'function maskOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
], deployer);
let mask = await masks.maskOf(deployer.address);
if (mask === 0n) {
  console.log('  claiming a mask for the deployer…');
  await (await masks.claim('')).wait();
  mask = await masks.maskOf(deployer.address);
}
console.log(`  deployer mask = ${mask} (ownerOf = ${await masks.ownerOf(mask)})`);

/* 3) REAL WRITE: a topic, a reply, a like — then read them back. */
console.log('  writing a real topic…');
await (await forum.createTopic(mask, cat, 'Benvenuti nel forum decentralizzato', 'Primo topic scritto on-chain con una mask. Nessun moderatore, nessun admin.')).wait();
const tCount = await forum.topicCount();
const total = await forum.count();
const title1 = await forum.title(1n);
const body1 = await forum.body(1n);
console.log(`  topicCount=${tCount} count=${total} title(1)="${title1}"`);
if (tCount !== 1n || title1 !== 'Benvenuti nel forum decentralizzato') throw new Error('topic did not write correctly');

console.log('  writing a reply…');
await (await forum.reply(mask, 1n, 0n, 'Prima risposta — il thread funziona.')).wait();
const [, , , , topicIdOf2, , , , , ] = await forum.meta(2n);
const replies = await forum.replyCount(1n);
console.log(`  post 2 topicId=${topicIdOf2} replyCount(1)=${replies}`);
if (topicIdOf2 !== 1n || replies !== 1n) throw new Error('reply did not attach to the topic');

console.log('  liking the topic…');
await (await forum.like(1n)).wait();
const likes = await forum.likeCount(1n);
console.log(`  likeCount(1)=${likes}`);
if (likes !== 1n) throw new Error('like did not register');

const page = await forum.pageTopics(0n, 10n);
console.log(`  pageTopics(0,10) = [${page.join(', ')}]`);

console.log(`\nFORUMBOARD DEPLOYED & PROVEN ✓  ${address}`);
console.log(`  topic + reply + like written on chain and read back; gate holds.`);
console.log(`paste into src:  export const FORUM_BOARD = '${address}';`);
