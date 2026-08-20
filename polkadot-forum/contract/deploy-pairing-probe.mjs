/**
 * Deploy PairingProbe and PROVE on chain whether a PolkaVM contract can use the
 * bn254 pairing precompile — the one capability the anonymous mask court needs.
 * Run from dotdirectory-app (it has the deps):
 *   node C:/Users/miche/Downloads/DOT/forum-app/contract/deploy-pairing-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Contract, Mnemonic, HDNodeWallet } from 'ethers';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { ss58Encode } from '@parity/product-sdk/address';

const BUILD = 'file:///C:/Users/miche/Downloads/DOT/forum-app/contract/build/';
const ETH_RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
const WS = ['wss://asset-hub-paseo-rpc.n.dwellir.com', 'wss://sys.turboflakes.io/asset-hub-paseo'];

const abi = JSON.parse(readFileSync(new URL('PairingProbe_sol_PairingProbe.abi', BUILD), 'utf8'));
const bytecode = '0x' + readFileSync(new URL('PairingProbe_sol_PairingProbe.polkavm', BUILD)).toString('hex');
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
  const evmAccountId = (h) =>
    ss58Encode(Uint8Array.from([...Buffer.from(h.replace(/^0x/, ''), 'hex'), ...new Array(12).fill(0xee)]));
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
  const alice = derive('//Alice');
  const signer = getPolkadotSigner(alice.publicKey, 'Sr25519', alice.sign);
  let client;
  for (const ws of WS) {
    try {
      client = createClient(getWsProvider(ws));
      await client.getTypedApi(devnet_asset_hub).query.System.Number.getValue();
      break;
    } catch {
      client = undefined;
    }
  }
  const api = client.getTypedApi(devnet_asset_hub);
  await api.tx.Balances.transfer_keep_alive({
    dest: { type: 'Id', value: evmAccountId(deployer.address) },
    value: 5n * 10n ** 10n,
  }).signAndSubmit(signer);
  client.destroy?.();
  bal = await provider.getBalance(deployer.address);
}
console.log(`balance ${bal}`);

console.log('deploying…');
const factory = new ContractFactory(abi, bytecode, deployer);
const c = await factory.deploy();
await c.waitForDeployment();
const addr = await c.getAddress();
console.log(`PairingProbe ${addr}`);

const probe = new Contract(addr, abi, provider);
const empty = await probe.pairEmpty();
const ident = await probe.pairIdentity();

console.log('\n================ RESULT (from INSIDE a PolkaVM contract) ================');
console.log(`pairEmpty()    ok=${empty[0]} called=${empty[1]} raw=${empty[2]}`);
console.log(`pairIdentity() ok=${ident[0]} called=${ident[1]} raw=${ident[2]}`);
const verdict = empty[0] && ident[0];
console.log(
  verdict
    ? '\n✅ bn254 pairing WORKS in-contract → groth16/ZK verifiable → anonymous jury is buildable'
    : '\n❌ pairing NOT usable in-contract → anonymous jury needs a non-ZK design',
);
console.log('=========================================================================');
