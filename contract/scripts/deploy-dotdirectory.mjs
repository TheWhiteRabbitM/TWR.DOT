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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit one chunk, retrying a stale nonce.
 *
 * Consecutive transactions from one account race the nonce: each submission
 * reads the account's nonce before the previous one is in a block, signs the
 * same number, and the chain answers {"type":"Invalid","value":{"type":"Stale"}}
 * for the loser. The same thing bites `dotns text set` right after a bulletin
 * upload in dotmetrics-refresh.yml, and the remedy there is the remedy here:
 * wait for the block and sign again against the nonce the previous one left.
 *
 * It has to be a try/catch and not a check on `res.ok`, because papi THROWS
 * InvalidTxError rather than returning it — which is why the first run of this
 * script died on chunk 1 instead of carrying on.
 */
/** Returns 'ok' | 'stale' | 'gas' | 'other', so the caller can react per case. */
async function trySubmit(data) {
  try {
    const res = await api.tx.Revive.call({
      dest: Binary.fromHex(address),
      value: 0n,
      // Left exactly as the working deploys in this repo declare it. Raising it
      // to "close to a full block" made every batch fail ExhaustsResources
      // instead — a declared weight larger than a block can hold is refused
      // before it runs. The batch size is the variable to move here, not this.
      weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
      storage_deposit_limit: 5n * 10n ** 12n,
      data: Binary.fromHex(data),
    }).signAndSubmit(signer);
    if (res.ok) return 'ok';
    const why = JSON.stringify(res.dispatchError ?? {});
    return why.includes('OutOfGas') ? 'gas' : 'other';
  } catch (err) {
    const why = JSON.stringify(err?.error ?? err?.message ?? '');
    if (why.includes('Stale')) return 'stale';
    // Both mean "this batch does not fit": OutOfGas is the contract running out
    // mid-execution, ExhaustsResources is the block refusing it up front. The
    // response to either is a smaller batch.
    if (why.includes('OutOfGas') || why.includes('ExhaustsResources')) return 'gas';
    console.error('  submit threw:', err?.message ?? err);
    return 'other';
  }
}

/**
 * Send a batch, halving it whenever the chain says OutOfGas.
 *
 * The batch size is not a constant to be guessed. Each announce inside the loop
 * makes an external call to the registry and writes two storage slots, so what
 * fits depends on weights this script cannot see — and guessing it wrong is what
 * lost 200 of the first 205 labels. Halving on OutOfGas finds the real ceiling
 * in a few attempts, whatever it happens to be, and needs no tuning if it moves.
 *
 * Stale nonces are retried in place: consecutive transactions from one account
 * race to read the nonce before the previous one is in a block, the same way
 * `dotns text set` races a bulletin upload in dotmetrics-refresh.yml.
 */
async function announceBatch(batch, depth = 0) {
  const pad = '  '.repeat(depth);
  const data = iface.encodeFunctionData('announceMany', [batch]);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const outcome = await trySubmit(data);
    if (outcome === 'ok') {
      console.log(`${pad}sent ${batch.length}: ${batch[0]} … ${batch[batch.length - 1]}`);
      return batch.length;
    }
    if (outcome === 'stale') {
      console.log(`${pad}stale nonce, waiting for the block (attempt ${attempt})`);
      await sleep(12_000);
      continue;
    }
    if (outcome === 'gas') {
      if (batch.length === 1) {
        console.error(`${pad}${batch[0]}: OutOfGas even alone — skipped`);
        return 0;
      }
      const half = Math.ceil(batch.length / 2);
      console.log(`${pad}${batch.length} too big, splitting into ${half} + ${batch.length - half}`);
      return (
        (await announceBatch(batch.slice(0, half), depth + 1)) +
        (await announceBatch(batch.slice(half), depth + 1))
      );
    }
    return 0;
  }
  return 0;
}

let added = 0;
for (let i = 0; i < labels.length; i += CHUNK) {
  added += await announceBatch(labels.slice(i, i + CHUNK));
  console.log(`progress: ${added}/${labels.length}`);
}

console.log(`\ncontract: ${address}`);
console.log('read it back with: count(), then page(start, size)');
client.destroy();
