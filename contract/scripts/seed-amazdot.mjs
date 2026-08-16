/**
 * Put a few real things on the shelves of the live market.
 *
 * Everything here goes through the same doors a user does: the seller claims
 * its own Peoplebook mask — one per account, soulbound, derived from the
 * address — and then calls `list`. Nothing is inserted behind the contract's
 * back, because a demo that took a shortcut would prove the shortcut works.
 *
 *   MNEMONIC="..." node scripts/seed-amazdot.mjs
 */
import { readFileSync } from 'node:fs';
import {
  JsonRpcProvider, HDNodeWallet, Mnemonic, Contract, keccak256, toUtf8Bytes, parseEther,
} from 'ethers';

const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io'];
const MARKET = '0x6D2eEfb18Cfb2f90dDd7B42c0db038d80eaCb162';
const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) throw new Error('set MNEMONIC');

const art = (n) =>
  JSON.parse(readFileSync(new URL(`../artifacts/contracts/${n}.sol/${n}.json`, import.meta.url), 'utf8'));

let provider;
for (const rpc of RPCS) {
  try {
    const p = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 20, staticNetwork: true });
    await p.getBlockNumber();
    provider = p;
    console.log(`rpc: ${rpc}`);
    break;
  } catch { /* next */ }
}
if (!provider) throw new Error('no rpc answered');

const seller = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(MNEMONIC), "m/44'/60'/0'/0/7").connect(provider);
console.log(`seller ${seller.address}`);

const masks = new Contract(
  MASKS,
  [
    'function claim(string dotLabel) returns (uint256)',
    'function maskOf(address) view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
  ],
  seller,
);

let mask = await masks.maskOf(seller.address);
if (mask === 0n) {
  console.log('claiming a mask…');
  // "" — no verified name. A `.dot` would need this account to own one, and
  // the mask is what the market keys on either way.
  await (await masks.claim('')).wait();
  mask = await masks.maskOf(seller.address);
}
if (mask === 0n) throw new Error('claim did not stick');
console.log(`mask #${mask} owned by ${await masks.ownerOf(mask)}\n`);

const market = new Contract(MARKET, art('Amazdot').abi, seller);

/* The key is invented here and its HASH is what reaches the chain. In a real
   listing the seller encrypts the file with it before uploading, and keeps it —
   without it they cannot prove delivery in a dispute. */
const items = [
  {
    title: 'Namehash cheatsheet (PDF)',
    price: '0.05',
    stock: 20,
    digital: true,
    payloadCid: 'bafkreicmtxqgyu6y4red6gaebblvp3p6qut544kyb33xiau7l5gy3al2em',
    secret: 'demo-key-cheatsheet',
  },
  {
    title: 'A font for terminals, 9 weights',
    price: '0.4',
    stock: 5,
    digital: true,
    payloadCid: 'bafkreidxgvc5tq3vrvkhaiucbwobzcsvt3cihuzxdgxolmvmq2bdubujra',
    secret: 'demo-key-font',
  },
  {
    title: 'Enamel pin, pink dot',
    price: '1.2',
    stock: 3,
    digital: false,
    payloadCid: '',
    secret: '',
  },
];

const ZERO32 = '0x' + '00'.repeat(32);
for (const it of items) {
  const commit = it.digital ? keccak256(toUtf8Bytes(it.secret)) : ZERO32;
  const r = await (
    await market.list(mask, it.title, '', '', it.payloadCid, commit, parseEther(it.price), it.stock, it.digital)
  ).wait();
  console.log(`listed "${it.title}" (${it.price} PAS x${it.stock}) block ${r.blockNumber}`);
}

// Read back rather than trust the receipts.
const count = await market.listingCount();
console.log(`\nlistingCount(): ${count}`);
for (let i = 0; i < Number(count); i++) {
  const l = await market.listing(i);
  console.log(`  #${i} ${l.title} — ${l.price} — stock ${l.stock} — ${l.digital ? 'digital' : 'shipped'}`);
}
