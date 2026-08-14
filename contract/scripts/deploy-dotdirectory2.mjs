// Deploy DotDirectory2 and migrate the directory into it, carrying the real
// arrival blocks rather than the migration's own.
//
// dotmetrics/indexer/apps.json holds a firstSeenBlock for every name — the block
// its registration was actually first observed in, often months before this
// contract existed. Announcing without it would stamp every name with today,
// which would make the arrival dates worse than useless: uniformly wrong and
// confidently displayed. announceManyDated takes the true value instead.
//
//   node scripts/deploy-dotdirectory2.mjs                # deploy + migrate
//   node scripts/deploy-dotdirectory2.mjs 0xADDRESS      # migrate into an existing one
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createClient, Binary } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';

const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const ARTIFACT = 'artifacts/contracts/DotDirectory2.sol/DotDirectory2.json';
const APPS = '../dotmetrics/indexer/apps.json';
/** Starting batch size. Halved on refusal, so this is a hint, not a limit. */
const CHUNK = Number(process.env.CHUNK ?? 20);

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

const artifact = JSON.parse(readFileSync(resolve(ARTIFACT), 'utf8'));
let address = process.argv[2];

// ------------------------------------------------------------------- deploy
if (!address) {
  const hex = artifact.bytecode;
  console.log(`deploying DotDirectory2: ${Math.round((hex.length - 2) / 2)} bytes`);
  const res = await api.tx.Revive.instantiate_with_code({
    value: 0n,
    weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
    storage_deposit_limit: 5n * 10n ** 12n,
    code: Binary.fromHex(hex),
    data: Binary.fromHex('0x'),
    salt: undefined,
  }).signAndSubmit(signer);

  if (!res.ok) {
    console.error('deploy failed:', JSON.stringify(res.dispatchError ?? res, null, 2));
    client.destroy();
    process.exit(1);
  }
  const ev = res.events.find((e) => e.type === 'Revive' && e.value?.type === 'Instantiated');
  const raw = ev?.value?.value?.contract;
  address = raw?.asHex?.() ?? raw;
  if (!address) {
    console.error('deployed but no Instantiated event');
    client.destroy();
    process.exit(1);
  }
  console.log(`DotDirectory2 deployed at: ${address}`);
}

// ------------------------------------------------------------------ migrate
const apps = JSON.parse(readFileSync(resolve(APPS), 'utf8'));
const rows = Object.entries(apps)
  .filter(([k]) => k !== 'excluded')
  .map(([label, v]) => ({ label, seen: Number(v?.firstSeenBlock ?? 0) || 0 }))
  .sort((a, b) => a.seen - b.seen || a.label.localeCompare(b.label));

const dated = rows.filter((r) => r.seen > 0).length;
console.log(`\nmigrating ${rows.length} labels, ${dated} of them with a real arrival block`);
console.log('names ordered oldest-first, so the on-chain array reads as arrival order\n');

const { Interface } = await import('ethers');
const iface = new Interface(artifact.abi);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trySubmit(data) {
  try {
    const res = await api.tx.Revive.call({
      dest: Binary.fromHex(address),
      value: 0n,
      weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
      storage_deposit_limit: 5n * 10n ** 12n,
      data: Binary.fromHex(data),
    }).signAndSubmit(signer);
    if (res.ok) return 'ok';
    // Log it. The previous version returned 'other' here in silence, so a
    // revert that was not OutOfGas produced a run of "progress: 0/205" with no
    // stated reason — the same swallowed-failure mistake twice in one evening.
    const why = JSON.stringify(res.dispatchError ?? {});
    if (why.includes('OutOfGas')) return 'gas';
    console.error('  reverted:', why.slice(0, 300));
    return 'other';
  } catch (err) {
    const why = `${err?.message ?? ''} ${JSON.stringify(err?.error ?? '')}`;
    if (why.includes('Stale')) return 'stale';
    // All three mean "this batch does not fit", and the third is the surprising
    // one: a payload that is too large does not come back as a clean weight
    // error but as a runtime panic — "wasm `unreachable` instruction executed"
    // — thrown out of the dry run. Classified as a generic failure it stopped
    // the splitter dead and produced a column of "progress: 0/205".
    if (
      why.includes('OutOfGas') ||
      why.includes('ExhaustsResources') ||
      why.includes('unreachable') ||
      why.includes('wasm trap')
    ) {
      return 'gas';
    }
    console.error('  threw:', err?.message ?? err);
    return 'other';
  }
}

/** Halve on refusal until it fits — the ceiling is not ours to guess. */
async function send(batch, depth = 0) {
  const pad = '  '.repeat(depth);
  const data = iface.encodeFunctionData('announceManyDated', [
    batch.map((r) => r.label),
    batch.map((r) => BigInt(r.seen)),
  ]);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const outcome = await trySubmit(data);
    if (outcome === 'ok') {
      console.log(`${pad}sent ${batch.length}: ${batch[0].label} … ${batch[batch.length - 1].label}`);
      return batch.length;
    }
    if (outcome === 'stale') {
      console.log(`${pad}stale nonce, waiting for the block (attempt ${attempt})`);
      await sleep(12_000);
      continue;
    }
    if (outcome === 'gas') {
      if (batch.length === 1) {
        console.error(`${pad}${batch[0].label}: does not fit even alone — skipped`);
        return 0;
      }
      const half = Math.ceil(batch.length / 2);
      console.log(`${pad}${batch.length} too big, splitting`);
      return (await send(batch.slice(0, half), depth + 1)) + (await send(batch.slice(half), depth + 1));
    }
    return 0;
  }
  return 0;
}

let added = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  added += await send(rows.slice(i, i + CHUNK));
  console.log(`progress: ${added}/${rows.length}`);
}

console.log(`\ncontract: ${address}`);
client.destroy();
