/**
 * Deploy Amazdot against the LIVE Peoplebook masks.
 *
 * The mask address is passed once into an immutable, so getting it wrong is not
 * something a later transaction can repair — the market would trust a contract
 * nobody uses and every seller check would fail. So it is probed first, with a
 * real account whose mask is already known, and the deploy only runs if the
 * answer matches.
 *
 * Afterwards the immutable is read back off the deployed code. A constructor
 * argument that was accepted and stored wrong looks exactly like one that was
 * stored right until the first seller tries to list.
 */
import { readFileSync } from 'node:fs';
import { JsonRpcProvider, HDNodeWallet, Mnemonic, ContractFactory, Contract } from 'ethers';

const RPCS = ['https://paseo-assethub-rpc.laissez-faire.trade', 'https://eth-rpc-testnet.polkadot.io'];
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

const wallet = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(MNEMONIC), "m/44'/60'/0'/0/0").connect(provider);
console.log(`from: ${wallet.address}`);
console.log(`balance: ${await provider.getBalance(wallet.address)}\n`);

/* ------------------------------------------------------------- preflight -- */

const code = await provider.getCode(MASKS);
if (code === '0x') throw new Error(`${MASKS} has no code — wrong address or wrong chain`);
console.log(`masks code: ${(code.length - 2) / 2} bytes`);

const masks = new Contract(
  MASKS,
  [
    'function ownerOf(uint256) view returns (address)',
    'function maskOf(address) view returns (uint256)',
    'function verifiedName(uint256) view returns (string)',
  ],
  provider,
);

// Round-trip a real holder: maskOf(owner) must give back the same id. A stub
// that answers zero to everything would pass a bare "does it respond" check.
let probedOk = false;
for (let id = 1n; id <= 12n && !probedOk; id++) {
  const owner = await masks.ownerOf(id).catch(() => null);
  if (!owner || /^0x0+$/i.test(owner)) continue;
  const back = await masks.maskOf(owner).catch(() => 0n);
  const name = await masks.verifiedName(id).catch(() => '');
  console.log(`  mask #${id} -> ${owner}  maskOf() -> ${back}${name ? `  "${name}"` : ''}`);
  if (back === id) probedOk = true;
}
if (!probedOk) throw new Error('no mask round-tripped: refusing to deploy against this address');
console.log('masks round-trip OK\n');

/* ---------------------------------------------------------------- deploy -- */

const a = art('Amazdot');
const market = await new ContractFactory(a.abi, a.bytecode, wallet).deploy(MASKS);
await market.waitForDeployment();
const addr = await market.getAddress();
console.log(`Amazdot deployed: ${addr}`);

const stored = await new Contract(addr, a.abi, provider).MASKS();
if (stored.toLowerCase() !== MASKS.toLowerCase()) {
  throw new Error(`immutable mismatch: stored ${stored}, expected ${MASKS}`);
}
console.log(`MASKS() reads back: ${stored}`);
console.log(`listingCount(): ${await new Contract(addr, a.abi, provider).listingCount()}`);
console.log(`\nAMAZDOT=${addr}`);
