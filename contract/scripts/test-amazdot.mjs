/**
 * Amazdot, exercised end to end on the real chain.
 *
 * There is no local PolkaVM node here, and testing a money contract on an EVM
 * simulator would prove it works somewhere it will never run. So this deploys a
 * fresh market against MockMasks on the devnet and drives every path with two
 * genuinely different accounts, asserting on chain state rather than receipts.
 *
 * The cases that matter are the adversarial ones. A happy-path suite would have
 * passed on the version of this contract where every physical buyer could
 * dispute, wait out the clock, and get their money back while keeping the goods.
 *
 *   MNEMONIC="..." node scripts/test-amazdot.mjs
 */
import { readFileSync } from 'node:fs';
import {
  JsonRpcProvider, HDNodeWallet, Mnemonic, ContractFactory, keccak256,
  toUtf8Bytes, parseEther, id,
} from 'ethers';

const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io'];
const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) throw new Error('set MNEMONIC');

const art = (name) =>
  JSON.parse(readFileSync(new URL(`../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url), 'utf8'));

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

// Three roles, three keys. Seller and buyer must be genuinely different
// accounts or the escrow proves nothing.
//
// `Wallet.fromPhrase(phrase, path)` does NOT do this: its second argument is a
// provider, so that spelling silently returned the same account three times and
// every escrow assertion would have compared an account with itself.
//
// These accounts are funded by dotdirectory-app/scripts/fund-evm.mjs, not by a
// faucet: the faucet funds the mnemonic's SUBSTRATE key and ethers derives an
// unrelated secp256k1 one that starts at zero.
const phrase = Mnemonic.fromPhrase(MNEMONIC);
const at = (i) => HDNodeWallet.fromMnemonic(phrase, `m/44'/60'/0'/0/${i}`).connect(provider);
const funder = at(0);
const seller = at(7);
const buyer = at(8);

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Every custom error's 4-byte selector, so a revert can be named by hand. */
const SELECTORS = Object.fromEntries(
  art('Amazdot').abi
    .filter((x) => x.type === 'error')
    .map((e) => [id(`${e.name}(${(e.inputs ?? []).map((i) => i.type).join(',')})`).slice(0, 10), e.name]),
);

/** Assert a call reverts, and — where an error is named — that it reverts for
 *  the RIGHT reason. "It threw" is not the same claim as "it refused".
 *
 *  ethers reports every one of these as "execution reverted (unknown custom
 *  error)" in `shortMessage`, and only fills `e.revert` for a staticCall — a
 *  real send fails during estimation and carries the payload somewhere else
 *  entirely. Matching on the message failed 25 assertions while the contract
 *  behaved perfectly. So the four-byte selector is pulled out of whichever
 *  field it landed in and looked up in the ABI, which works for both shapes. */
const nameOfRevert = (e) => {
  if (e?.revert?.name) return e.revert.name;
  const raw = e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? e?.value?.data;
  const hex = typeof raw === 'string' ? raw : raw?.data;
  if (typeof hex === 'string' && hex.startsWith('0x') && hex.length >= 10) {
    return SELECTORS[hex.slice(0, 10)] ?? `unknown(${hex.slice(0, 10)})`;
  }
  return String(e?.shortMessage ?? e?.message ?? e);
};

const rejects = async (name, fn, expect) => {
  try {
    const tx = await fn();
    await tx.wait?.();
    failed++;
    console.log(`  FAIL  ${name} — did not revert`);
  } catch (e) {
    const got = nameOfRevert(e);
    if (expect && got !== expect && !String(got).includes(expect)) {
      failed++;
      console.log(`  FAIL  ${name} — reverted with ${String(got).slice(0, 90)}, wanted ${expect}`);
    } else { passed++; console.log(`  ok    ${name}`); }
  }
};

/** What a receipt cost its sender, so a balance assertion can subtract it.
 *  A seller who calls `prove` themselves receives the price and pays the gas;
 *  asserting an exact +PRICE there fails on a contract that is behaving. */
const fee = (r) => (r?.gasUsed ?? 0n) * (r?.gasPrice ?? r?.effectiveGasPrice ?? 0n);

/** The public RPC drops connections under a long run — one ECONNRESET killed
 *  the first attempt mid-suite. Transport failures retry; contract refusals do
 *  not, or the suite would paper over the thing it exists to test. */
const send = async (make, tries = 4) => {
  for (let i = 1; ; i++) {
    try {
      return await (await make()).wait();
    } catch (e) {
      const s = `${e?.code ?? ''} ${e?.message ?? ''}`;
      const transient = ['ECONNRESET', 'ETIMEDOUT', 'SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT']
        .some((c) => s.includes(c));
      if (!transient || i >= tries) throw e;
      console.log(`  ..    transport hiccup, retry ${i}/${tries - 1}`);
      await new Promise((r) => setTimeout(r, 2500 * i));
    }
  }
};

/* ------------------------------------------------------------- funding ---- */

for (const [who, w] of [['funder', funder], ['seller', seller], ['buyer', buyer]]) {
  const bal = await provider.getBalance(w.address);
  console.log(`${who.padEnd(6)} ${w.address} ${bal}`);
  if (bal === 0n) {
    throw new Error(`${w.address} has nothing — run fund-evm.mjs ${w.address} --amount 8`);
  }
}
console.log('');

/* -------------------------------------------------------------- deploy ---- */

const mkArt = art('MockMasks');
const mtArt = art('Amazdot');
const masks = await (await new ContractFactory(mkArt.abi, mkArt.bytecode, funder).deploy()).waitForDeployment();
const market = await (
  await new ContractFactory(mtArt.abi, mtArt.bytecode, funder).deploy(await masks.getAddress())
).waitForDeployment();
console.log(`masks  ${await masks.getAddress()}`);
console.log(`market ${await market.getAddress()}\n`);

const SELLER_MASK = 11n, BUYER_MASK = 22n;
const asMasks = masks.connect(funder);
await send(() => asMasks.setMask(SELLER_MASK, seller.address));
await send(() => asMasks.setMask(BUYER_MASK, buyer.address));

const asSeller = market.connect(seller);
const asBuyer = market.connect(buyer);
const asFunder = market.connect(funder);

const KEY = toUtf8Bytes('the-symmetric-key-for-the-file');
const COMMIT = keccak256(KEY);
const ZERO32 = '0x' + '00'.repeat(32);
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const PRICE = parseEther('0.01');

/* ------------------------------------------------------------- listing ---- */

console.log('listing');
await rejects('a stranger cannot list under a mask they do not hold',
  () => asBuyer.list(SELLER_MASK, 'x', '', '', '', COMMIT, PRICE, 1, true), 'NotSeller');
await rejects('mask zero cannot list',
  () => asSeller.list(0, 'x', '', '', '', COMMIT, PRICE, 1, true), 'NoMask');
await rejects('a free item is refused',
  () => asSeller.list(SELLER_MASK, 'x', '', '', '', COMMIT, 0, 1, true), 'BadPrice');
await rejects('a digital item with no key commitment is refused',
  () => asSeller.list(SELLER_MASK, 'x', '', '', '', ZERO32, PRICE, 1, true), 'BadKey');

await send(() => asSeller.list(SELLER_MASK, 'digital happy', '', '', 'cid1', COMMIT, PRICE, 5, true));
await send(() => asSeller.list(SELLER_MASK, 'dispute win', '', '', 'cid2', COMMIT, PRICE, 5, true));
await send(() => asSeller.list(SELLER_MASK, 'seller refunds', '', '', 'cid3', COMMIT, PRICE, 5, true));
await send(() => asSeller.list(SELLER_MASK, 'physical', '', '', '', ZERO32, PRICE, 5, false));
await send(() => asSeller.list(SELLER_MASK, 'dispute lose', '', '', 'cid5', COMMIT, PRICE, 5, true));
ok('five listings exist', Number(await market.listingCount()) === 5);

/* -------------------------------------------------------------- buying ---- */

console.log('\nbuying');
await rejects('paying under the price is refused', () => asBuyer.buy(0, '0x', { value: PRICE - 1n }), 'Underpaid');
await rejects('overpaying is refused too', () => asBuyer.buy(0, '0x', { value: PRICE + 1n }), 'Underpaid');
await rejects('a buyer with no mask is refused', () => asFunder.buy(0, '0x', { value: PRICE }), 'NoMask');
// Free five-star reviews, if this is missing: a confirmed order is the only way
// to write one, and buying from yourself returns the escrow to your own pocket.
await rejects('a seller cannot buy from themselves',
  () => asSeller.buy(0, '0x', { value: PRICE }), 'SelfDeal');

await send(() => asBuyer.buy(0, '0x', { value: PRICE }));
const o0 = await market.order(0);
ok('order records the buyer', o0.buyer.toLowerCase() === buyer.address.toLowerCase());
ok('order carries the buyer mask', o0.buyerMask === BUYER_MASK, String(o0.buyerMask));
ok('order is Paid', Number(o0.state) === 1);
ok('escrow holds the money', (await provider.getBalance(await market.getAddress())) >= PRICE);
ok('stock went down', Number((await market.listing(0)).stock) === 4);

/* ---------------------------------------------------------- delivering ---- */

console.log('\ndelivering');
await rejects('a stranger cannot deliver', () => asBuyer.deliver(0, '0xdead'), 'NotSeller');
await rejects('ship() is refused on a digital order', () => asSeller.ship(0, 'x'), 'BadState');
await send(() => asSeller.deliver(0, '0xc0ffee'));
ok('order is Delivered', Number((await market.order(0)).state) === 2);
await rejects('delivering twice is refused', () => asSeller.deliver(0, '0xc0ffee'), 'BadState');

/* ---------------------------------------------------------- happy path ---- */

console.log('\nconfirm');
await rejects('a stranger cannot confirm', () => asFunder.confirm(0), 'NotBuyer');
const s0 = await provider.getBalance(seller.address);
await send(() => asBuyer.confirm(0));
ok('seller was paid', (await provider.getBalance(seller.address)) - s0 === PRICE);
ok('order is Confirmed', Number((await market.order(0)).state) === 3);
ok('sale counted on the mask', Number(await market.sales(SELLER_MASK)) === 1);
await rejects('confirming twice is refused', () => asBuyer.confirm(0), 'BadState');

/* ------------------------------------------------------------- reviews ---- */

console.log('\nreviews');
await rejects('a non-buyer cannot review', () => asFunder.review(0, 5, 'x'), 'NotBuyer');
await rejects('zero stars is refused', () => asBuyer.review(0, 0, 'x'), 'BadStars');
await rejects('six stars is refused', () => asBuyer.review(0, 6, 'x'), 'BadStars');
await send(() => asBuyer.review(0, 5, 'worked'));
await rejects('reviewing twice is refused', () => asBuyer.review(0, 4, 'again'), 'BadState');
const [avg, count] = await market.rating(SELLER_MASK);
ok('rating is 5.00 from 1 review', Number(avg) === 500 && Number(count) === 1, `${avg}/${count}`);

/* ------------------------------------------- dispute: seller can prove ---- */

console.log('\ndispute — seller proves by publishing the goods');
await send(() => asBuyer.buy(1, '0x', { value: PRICE }));
await send(() => asSeller.deliver(1, '0xbeef'));
await rejects('settling before the timeout is refused', () => asFunder.settle(1), 'TooEarly');
await send(() => asBuyer.dispute(1, 'key did not work'));
ok('order is Disputed', Number((await market.order(1)).state) === 4);
await rejects('proving with the wrong key fails', () => asSeller.prove(1, toUtf8Bytes('wrong')), 'BadKey');
await rejects('refunding before the prove window is refused', () => asFunder.refund(1), 'TooEarly');
// Asserted on the ESCROW, not on the seller's wallet. When the payee also
// sends the transaction their balance moves by price-minus-fee, and the fee is
// not `gasUsed * gasPrice`: pallet-revive charges by weight and refunds what is
// unused, so the receipt overstates it — measured, by 0.00003 PAS. Chasing that
// would be testing the fee model. The contract's own balance dropping by
// exactly the price is the invariant that matters, and it costs nothing.
const s1 = await provider.getBalance(seller.address);
const esc1 = await provider.getBalance(await market.getAddress());
await send(() => asSeller.prove(1, KEY));
ok('proving releases exactly the price from escrow',
  esc1 - (await provider.getBalance(await market.getAddress())) === PRICE);
ok('and the seller ends up better off', (await provider.getBalance(seller.address)) > s1);
ok('order is Settled', Number((await market.order(1)).state) === 6);

/* -------------------------------------------------- seller gives up ------- */

console.log('\nseller refunds voluntarily');
await send(() => asBuyer.buy(2, '0x', { value: PRICE }));
const stock2 = Number((await market.listing(2)).stock);
const b2 = await provider.getBalance(buyer.address);
await send(() => asSeller.refundBuyer(2));
ok('buyer got the money back', (await provider.getBalance(buyer.address)) - b2 === PRICE);
ok('stock came back', Number((await market.listing(2)).stock) === stock2 + 1);
ok('order is Refunded', Number((await market.order(2)).state) === 5);

/* --------------------------- THE ONE THIS FILE EXISTS FOR: physical ------- */

console.log('\nphysical dispute must NOT time out into a free refund');
await send(() => asBuyer.buy(3, '0x646561646265656664617461', { value: PRICE }));
ok('the delivery blob is stored as ciphertext',
  (await market.order(3)).sealed_ === '0x646561646265656664617461');
await rejects('deliver() is refused on a physical order', () => asSeller.deliver(3, '0x00'), 'BadState');
await send(() => asSeller.ship(3, 'tracking 123'));
await send(() => asBuyer.dispute(3, 'never arrived'));
await rejects('prove() is refused on a physical order', () => asSeller.prove(3, KEY), 'BadState');
await rejects('refund() is refused on a physical order — no free goods',
  () => asFunder.refund(3), 'BadState');

/* -------------------------------------------------- mutual settlement ----- */

console.log('\nproposeSplit — two sides must agree');
await rejects("a stranger cannot propose on someone else's order",
  () => asFunder.proposeSplit(3, 4000), 'NotParty');
await rejects('a split above 100% is refused', () => asBuyer.proposeSplit(3, 10001), 'BadSplit');

await send(() => asSeller.proposeSplit(3, 4000));
ok('one proposal alone moves nothing', Number((await market.order(3)).state) === 4);
await send(() => asBuyer.proposeSplit(3, 5000));
ok('a mismatched pair still moves nothing', Number((await market.order(3)).state) === 4);

const s3 = await provider.getBalance(seller.address);
await send(() => asBuyer.proposeSplit(3, 4000));
ok('agreeing pays the seller 60%',
  (await provider.getBalance(seller.address)) - s3 === (PRICE * 6000n) / 10000n);
ok('order is Settled', Number((await market.order(3)).state) === 6);

/* ------------------------------------------ digital dispute, no answer ---- */

console.log('\ndigital dispute the seller ignores');
await send(() => asBuyer.buy(4, '0x', { value: PRICE }));
await send(() => asSeller.deliver(4, '0xf00d'));
await send(() => asBuyer.dispute(4, 'garbage'));
ok('a disputed digital order stays disputed', Number((await market.order(4)).state) === 4);
await rejects('refund still waits for the window', () => asFunder.refund(4), 'TooEarly');
// PROVE_WINDOW is 14,400 blocks — about a day. Waiting it out in a live test is
// not possible, so this asserts the GATE and says plainly that the elapsed
// branch is uncovered rather than pretending otherwise.
console.log('  note  the post-window refund branch is NOT covered here (needs 14,400 blocks ≈ 24h)');

/* ------------------------------------------------------------- backstop --- */

console.log('\nseller mask cleared mid-order (backstop; unreachable with real soulbound masks)');
await send(() => asSeller.list(SELLER_MASK, 'backstop', '', '', 'cid6', COMMIT, PRICE, 1, true));
await send(() => asBuyer.buy(5, '0x', { value: PRICE }));
await send(() => asSeller.deliver(5, '0xaaaa'));
await send(() => asMasks.setMask(SELLER_MASK, ZERO_ADDR));
const b5 = await provider.getBalance(buyer.address);
await send(() => asBuyer.confirm(5));
ok('a payout to a vanished mask refunds instead of burning',
  (await provider.getBalance(buyer.address)) > b5);
ok('order is Refunded', Number((await market.order(5)).state) === 5);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
