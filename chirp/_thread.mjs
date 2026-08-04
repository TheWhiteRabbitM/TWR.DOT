// Post the "what chirp does" thread, from the demo mask, as a real thread:
// each part replies to the one before, exactly as the app composes one.
//
// Run from chirp/ with MNEMONIC in the environment.
import { readFileSync } from 'node:fs';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import * as descriptors from '@parity/product-sdk-descriptors/devnet-asset-hub';
import * as contracts from '@parity/product-sdk/contracts';

const CHIRP = '0x37A7CE834428636815b2746408343574aD13be7C';
const MASK = 1n;
const abi = JSON.parse(readFileSync('src/chirp-abi.json', 'utf8'));

const PARTS = [
  `chirp is X, on chain. Every post, like, follow and reply is a contract call on Asset Hub. No server holds any of it, and reading needs no wallet at all. Here is everything it does, and how to use it.`,

  `Identity is a mask. It is bound to your account and cannot be transferred, so nobody can post as you. The blue tick is only ever a .dot the contract checked against the registry - a display name proves nothing, exactly as on X.`,

  `Posting: tap +. 280 characters, text only. You can edit a chirp after posting, and delete it, both from the ... menu on your own. The edit is stamped on chain, so nobody rewrites history quietly.`,

  `Threads: while writing, tap + to add another part. They go out in order, each replying to the one before, and you sign each one. Stop halfway and what already went out stays out - the app tells you how far it got rather than pretending it failed.`,

  `Mentions: type @ and pick from the people actually here. You are told when somebody names you, alongside replies and quotes, and the screen says which of the three each one is instead of piling them together.`,

  `GIFs cost nothing on chain and nothing on Bulletin, because only the link is stored. Tap GIF in the composer and paste one from Giphy, or the image address from Tenor - it starts with media.tenor.com. https://i.giphy.com/3o7abKhOpu0NwenH3O.gif`,

  `Three timelines. For you is ranked. Latest is strictly chronological. Following is the people you follow. Any chirp will tell you "why am I seeing this" from the ... menu, with every term and its value.`,

  `The ranking, in full: engagement, whether you follow them, reach through a logarithm so the biggest voice does not take the feed, your own topics from what you wrote and liked, a bonus for being new that halves every two hours. Nothing from watching you read.`,

  `Community notes: add context to any chirp from the ... menu. A note only appears on the chirp when people who normally disagree BOTH find it helpful - votes alone will not do it. The scoring runs in your own browser, over ratings anyone can recompute.`,

  `Your picture: Settings, paste an image or choose a file. The image itself goes into the contract, not a link to it, so it cannot expire and survives clearing your browser. Bookmarks and mutes stay on your device, where they belong.`,

  `Pin a chirp to the top of your profile from the ... menu. Your profile splits into Chirps, Replies and Likes. Your numbers are under "your numbers" - counted from the contract, with no impressions, because nothing here records who read what.`,

  `Read it all yourself: chirps 0x37A7CE83, masks 0x4c1fe8F4, notes 0xf3584d1b, faces 0xbc11688b, pins 0x5f9199ca. chirpwatch.dot watches whether they are answering, and Settings > Diagnostics tests what this app actually allows.`,
];

for (const [i, p] of PARTS.entries()) {
  const n = new TextEncoder().encode(p).length;
  if (n > 280) { console.error(`part ${i + 1} is ${n} bytes, over 280`); process.exit(1); }
}
console.log(`${PARTS.length} parts, longest ${Math.max(...PARTS.map((p) => new TextEncoder().encode(p).length))} bytes`);

const kp = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(process.env.MNEMONIC)))('');
const signer = getPolkadotSigner(kp.publicKey, 'Sr25519', kp.sign);
const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
const rt = contracts.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
const c = contracts.createContract(rt, CHIRP, abi, { signer });
const G = { gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n }, storageDepositLimit: 10n ** 18n, signer };

/** The id our last chirp was given: walk back and match on body, because the
 *  count alone could be somebody else's chirp posted in between. */
async function mine(body) {
  const total = Number((await c.count.query()).value);
  for (let id = total; id > 0 && id > total - 8; id--) {
    const b = String((await c.body.query(BigInt(id))).value ?? '');
    if (b === body) return BigInt(id);
  }
  return 0n;
}

let parent = 0n;
for (const [i, part] of PARTS.entries()) {
  const r = await c.chirp.tx(MASK, part, parent, 0n, G);
  if (r?.ok === false) { console.error(`part ${i + 1} failed:`, JSON.stringify(r).slice(0, 200)); break; }
  parent = await mine(part);
  console.log(`part ${i + 1}/${PARTS.length} -> chirp #${parent}`);
  if (!parent) { console.error('could not confirm the id; stopping so the rest is not chained to a stranger'); break; }
}
client.destroy();
