/**
 * deploy-dotmail.mjs — put DotMail on Asset Hub.
 *
 * Same shape as deploy-chirpnotes.mjs, whose comments record what this API
 * actually wants: Binary.fromHex rather than fromBytes, a weight_limit that
 * comes back as InvalidTxError if you ask for more, and an address that is a
 * Binary off the untyped api rather than a string.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createClient, Binary } from 'polkadot-api';
// papi 1.15 here, not the 2.x the apps carry: the provider lives under
// ws-provider/node, and 'polkadot-api/ws' does not exist in this version.
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';

const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const NAME = 'dotmailkeys';

function fromKeystore() {
  try {
    return JSON.parse(readFileSync(resolve(homedir(), '.cdm/accounts.json'), 'utf8')).devnet?.mnemonic ?? '';
  } catch { return ''; }
}

const mnemonic = process.env.MNEMONIC || fromKeystore();
if (!mnemonic) { console.error('no mnemonic'); process.exit(1); }

const pair = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)))('');
const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign);

const client = createClient(getWsProvider(RPC));
const api = client.getUnsafeApi();

const code = readFileSync(resolve(`target/cdm/hardhat/_thebutton_${NAME}.polkavm`));
console.log(`${NAME}: ${code.length} bytes of PolkaVM`);

const res = await api.tx.Revive.instantiate_with_code({
  value: 0n,
  weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
  storage_deposit_limit: 5n * 10n ** 12n,
  code: Binary.fromHex('0x' + code.toString('hex')),
  data: Binary.fromHex('0x'),
  salt: undefined,
}).signAndSubmit(signer);

if (!res.ok) {
  console.error('deploy failed:', JSON.stringify(res.dispatchError ?? res, null, 2).slice(0, 400));
  client.destroy();
  process.exit(1);
}
const ev = res.events.find((e) => e.type === 'Revive' && e.value?.type === 'Instantiated');
const addr = ev?.value?.value?.contract;
console.log('DotMailKeys deployed at:', addr?.asHex?.() ?? addr ?? '(no Instantiated event)');
client.destroy();
process.exit(0);
