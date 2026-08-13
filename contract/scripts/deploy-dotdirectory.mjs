// Deploy DotDirectory, then backfill it with the labels the indexer already found.
//
// Two steps in one script because they only make sense together: an empty
// directory contract is worse than no directory contract, and the 206 names in
// dotmetrics/indexer/apps.json are exactly the set an on-chain list should start
// from. After this runs, discovery is a contract read and the hourly block scan
// stops being load-bearing.
//
// The mnemonic is read from the environment or the keystore into memory and is
// never printed. It is the one thing this script will not do for you.
//
//   node scripts/deploy-dotdirectory.mjs                 # deploy + backfill
//   node scripts/deploy-dotdirectory.mjs 0xADDRESS       # backfill an existing one
//
// Run from contract/. Needs MNEMONIC in the environment, or ~/.cdm/accounts.json
// readable (which on the original machine means running it inside WSL).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createClient, Binary } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';

const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const ARTIFACT = 'artifacts/contracts/DotDirectory.sol/DotDirectory.json';
const APPS = '../dotmetrics/indexer/apps.json';
/** announceMany is one transaction per chunk; keep each inside the weight limit. */
const CHUNK = 25;

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
const api = client.getUnsafeApi();

let address = process.argv[2];

// ------------------------------------------------------------------- deploy
if (!address) {
  const artifact = JSON.parse(readFileSync(resolve(ARTIFACT), 'utf8'));
  const hex = artifact.bytecode;
  if (!hex || hex.length < 4) {
    console.error(`${ARTIFACT} has no bytecode — run "npx hardhat compile" first`);
    process.exit(1);
  }
  console.log(`deploying DotDirectory: ${Math.round((hex.length - 2) / 2)} bytes`);

  const res = await api.tx.Revive.instantiate_with_code({
    value: 0n,
    // Anything larger comes back as InvalidTxError rather than an over-limit error.
    weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
    storage_deposit_limit: 5n * 10n ** 12n,
    code: Binary.fromHex(hex),
    data: Binary.fromHex('0x'),   // no constructor arguments
    salt: undefined,
  }).signAndSubmit(signer);

  if (!res.ok) {
    console.error('deploy failed:', JSON.stringify(res.dispatchError ?? res, null, 2));
    client.destroy();
    process.exit(1);
  }
  const ev = res.events.find((e) => e.type === 'Revive' && e.value?.type === 'Instantiated');
  // Off the untyped api the address is a Binary, not a string: printing it
  // straight gives "[object Object]" and loses the deploy.
  const raw = ev?.value?.value?.contract;
  address = raw?.asHex?.() ?? raw;
  if (!address) {
    console.error('deployed but no Instantiated event — cannot continue to backfill');
    client.destroy();
    process.exit(1);
  }
  console.log(`DotDirectory deployed at: ${address}`);
}

// ------------------------------------------------------------------ backfill
const apps = JSON.parse(readFileSync(resolve(APPS), 'utf8'));
const labels = Object.keys(apps).filter((k) => k !== 'excluded').sort();
console.log(`\nbackfilling ${labels.length} labels from apps.json in chunks of ${CHUNK}`);
console.log('announceMany skips anything unregistered or already listed, so re-running is safe\n');

// Calldata is encoded from the compiled ABI rather than a pasted selector, so a
// signature change can never leave a stale constant behind.
const { Interface } = await import('ethers');
const iface = new Interface(
  JSON.parse(readFileSync(resolve(ARTIFACT), 'utf8')).abi,
);

let added = 0;
for (let i = 0; i < labels.length; i += CHUNK) {
  const chunk = labels.slice(i, i + CHUNK);
  const data = iface.encodeFunctionData('announceMany', [chunk]);
  const n = i / CHUNK + 1;

  const res = await api.tx.Revive.call({
    dest: Binary.fromHex(address),
    value: 0n,
    weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
    storage_deposit_limit: 5n * 10n ** 12n,
    data: Binary.fromHex(data),
  }).signAndSubmit(signer);

  if (!res.ok) {
    // One bad chunk must not cost the rest their turn — announceMany is
    // idempotent, so the whole run can simply be repeated afterwards.
    console.error(`chunk ${n}: failed —`, JSON.stringify(res.dispatchError ?? {}, null, 2));
    continue;
  }
  added += chunk.length;
  console.log(`chunk ${n}: submitted ${chunk.length} labels (${added}/${labels.length})`);
}

console.log(`\ncontract: ${address}`);
console.log('read it back with: count(), then page(start, size)');
client.destroy();
