/**
 * What a revert actually looks like coming back from pallet-revive.
 *
 * The suite asserts that each refusal happens for the RIGHT reason, which needs
 * the custom error to be identifiable. ethers reported "unknown custom error",
 * so before writing a decoder this checks what is really on the wire: whether
 * revert data comes back at all, and in what shape.
 */
import { readFileSync } from 'node:fs';
import { JsonRpcProvider, HDNodeWallet, Mnemonic, ContractFactory, Contract, id } from 'ethers';

const art = (n) =>
  JSON.parse(readFileSync(new URL(`../artifacts/contracts/${n}.sol/${n}.json`, import.meta.url), 'utf8'));

const provider = new JsonRpcProvider('https://paseo-assethub-rpc.laissez-faire.trade', undefined, {
  staticNetwork: true,
});
const phrase = Mnemonic.fromPhrase(process.env.MNEMONIC);
const w = HDNodeWallet.fromMnemonic(phrase, "m/44'/60'/0'/0/0").connect(provider);

const mk = art('MockMasks');
const mt = art('Amazdot');
const masks = await (await new ContractFactory(mk.abi, mk.bytecode, w).deploy()).waitForDeployment();
const market = await (
  await new ContractFactory(mt.abi, mt.bytecode, w).deploy(await masks.getAddress())
).waitForDeployment();

// Selectors the ABI knows about, so the raw data can be matched by hand.
const selectors = Object.fromEntries(
  mt.abi.filter((x) => x.type === 'error').map((e) => [id(`${e.name}()`).slice(0, 10), e.name]),
);
console.log('known selectors:', Object.entries(selectors).map(([k, v]) => `${k}=${v}`).join(' '));

const c = new Contract(await market.getAddress(), mt.abi, w);
try {
  await c.list.staticCall(99n, 'x', '', '', '', id('k'), 1n, 1, true);
  console.log('NO REVERT — unexpected');
} catch (e) {
  console.log('\nshortMessage:', e.shortMessage);
  console.log('code        :', e.code);
  console.log('e.data      :', e.data);
  console.log('e.info      :', JSON.stringify(e.info)?.slice(0, 400));
  console.log('e.revert    :', e.revert);
  const raw = e.data ?? e.info?.error?.data;
  if (typeof raw === 'string' && raw.length >= 10) {
    console.log('selector    :', raw.slice(0, 10), '->', selectors[raw.slice(0, 10)] ?? 'unknown');
  }
}
