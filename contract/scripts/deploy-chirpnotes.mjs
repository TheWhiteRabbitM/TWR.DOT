// Deploy ChirpNotes straight through Revive.instantiate_with_code.
//
// `cdm deploy` cannot be used: it traps (Revive.ContractTrapped) while
// REGISTERING any name the ContractRegistry has not seen before — proven with a
// two-line contract and with the registry address passed explicitly. The
// instantiate itself is fine, so we do that part alone and skip the registry.
//
// The mnemonic is read from the WSL keystore into memory and never printed.
//
// Run it from chirp/, which has the dependencies:
//   cd chirp && node ../contract/scripts/deploy-chirpnotes.mjs
// The keystore lives in the WSL home, so from Windows either run this inside
// WSL, or pass MNEMONIC in from a shell that can read it.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createClient, Binary } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';

const BLOB = resolve('../contract/target/cdm/hardhat/_thebutton_chirpnotes.polkavm');
const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';

/** The keystore's shape is not documented and has one entry per environment, so
 *  look rather than assume — and never print what is found. */
function fromKeystore() {
  let raw;
  try { raw = readFileSync(resolve(homedir(), '.cdm/accounts.json'), 'utf8'); } catch { return ''; }
  const root = JSON.parse(raw);
  const entry = root.devnet ?? root;
  for (const k of ['mnemonic', 'suri', 'seed', 'phrase', 'secret']) {
    const v = typeof entry === 'string' ? entry : entry?.[k];
    if (typeof v === 'string' && v.trim().split(/\s+/).length >= 12) return v.trim();
  }
  return '';
}

const mnemonic = process.env.MNEMONIC || fromKeystore();
if (!mnemonic) {
  console.error('no mnemonic: set MNEMONIC, or run this where ~/.cdm/accounts.json is readable');
  process.exit(1);
}

const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)));
const pair = derive('');
const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign);

const client = createClient(getWsProvider(RPC));
const api = client.getTypedApi(devnet_asset_hub);

const code = readFileSync(BLOB);
console.log(`blob: ${code.length} bytes`);

const res = await api.tx.Revive.instantiate_with_code({
  value: 0n,
  // Anything larger comes back as InvalidTxError rather than an over-limit error.
  weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
  storage_deposit_limit: 5n * 10n ** 12n,
  // Binary.fromBytes does not exist in this papi, and fromOpaque rejects raw bytes.
  code: Binary.fromHex('0x' + code.toString('hex')),
  data: Binary.fromHex('0x'),   // no constructor arguments
  salt: undefined,
}).signAndSubmit(signer);

if (!res.ok) {
  console.error('deploy failed:', JSON.stringify(res.dispatchError ?? res, null, 2));
  process.exit(1);
}
const ev = res.events.find((e) => e.type === 'Revive' && e.value?.type === 'Instantiated');
console.log('ChirpNotes deployed at:', ev?.value?.value?.contract ?? '(no Instantiated event)');
client.destroy();
