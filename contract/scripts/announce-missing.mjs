// Announce registered names the directory does not yet hold.
//
// NAMES COME FROM THE ARGUMENTS, NOT FROM dotmetrics.
//
// The whole point of DotDirectory is to stop depending on an indexer that can
// stall — and one did, on 10 August, which is why three names published while
// building this app were missing from a directory seeded from its snapshot.
// Reading apps.json on every run would have quietly rebuilt that dependency, so
// it is now behind --bootstrap and is meant to be used once, ever: it was the
// only existing corpus of plaintext labels and seeding from it was a genuine
// one-off, not a data source.
//
// Ongoing, names reach the directory by being announced — by whoever registers
// one, or by anyone doing them the favour. Nothing here discovers.
//
// Idempotent: announceMany skips whatever is already listed, so re-running is
// always safe.
//
//   MNEMONIC=... node scripts/announce-missing.mjs alice bob
//   MNEMONIC=... node scripts/announce-missing.mjs --bootstrap   # once, ever
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { JsonRpcProvider, Contract, Interface } from 'ethers';
import { createClient, Binary } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';

const REPO =
  'C:/Users/miche/AppData/Local/Temp/claude/C--Users-miche-Downloads-DOT/833686bf-3682-4401-a19f-40f75d928403/scratchpad/TWR.DOT';
const DIRECTORY = '0x4a6f03683b113a4fc820ca6b0af793cde3f9348e';
const abi = JSON.parse(
  readFileSync(`${REPO}/contract/artifacts/contracts/DotDirectory2.sol/DotDirectory2.json`, 'utf8'),
).abi;

function fromKeystore() {
  try {
    const root = JSON.parse(readFileSync(resolve(homedir(), '.cdm/accounts.json'), 'utf8'));
    const entry = root.devnet ?? root;
    for (const k of ['mnemonic', 'suri', 'seed', 'phrase', 'secret']) {
      const v = typeof entry === 'string' ? entry : entry?.[k];
      if (typeof v === 'string' && v.trim().split(/\s+/).length >= 12) return v.trim();
    }
  } catch {
    /* no keystore here */
  }
  return '';
}

const mnemonic = process.env.MNEMONIC || fromKeystore();
if (!mnemonic) {
  console.error('no mnemonic: set MNEMONIC, or run where ~/.cdm/accounts.json is readable');
  process.exit(1);
}

// ---- what is missing -------------------------------------------------------
const read = new JsonRpcProvider('https://paseo-assethub-rpc.laissez-faire.trade', undefined, {
  staticNetwork: true,
  batchMaxCount: 50,
});
const dir = new Contract(DIRECTORY, abi, read);

const total = Number(await dir.count());
const pages = [];
for (let i = 0; i < total; i += 20) pages.push(dir.pageDetailed(i, 20));
const listed = new Set((await Promise.all(pages)).flat().map((e) => e.label));

const args = process.argv.slice(2);
const bootstrap = args.includes('--bootstrap');
const named = args.filter((a) => !a.startsWith('--'));

if (!bootstrap && named.length === 0) {
  console.error('nothing to announce. Pass labels, or --bootstrap for the one-off seed.');
  process.exit(1);
}

// Only behind the flag, and only ever meant to run once: see the header.
const seed = bootstrap
  ? Object.keys(JSON.parse(readFileSync(`${REPO}/dotmetrics/indexer/apps.json`, 'utf8'))).filter(
      (k) => k !== 'excluded',
    )
  : [];
if (bootstrap) console.log(`--bootstrap: seeding from a ${seed.length}-name snapshot, one-off`);

const missing = [...new Set([...named, ...seed])].filter((l) => !listed.has(l));
console.log(`directory holds ${listed.size}; ${missing.length} to announce`);
if (missing.length === 0) {
  console.log('nothing to do');
  process.exit(0);
}
console.log(missing.join(', '));

// ---- announce --------------------------------------------------------------
const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)));
const pair = derive('');
const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign);
const client = createClient(getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
const api = client.getUnsafeApi();
const iface = new Interface(abi);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = 0;
for (const label of missing) {
  const data = iface.encodeFunctionData('announceMany', [[label]]);
  let sent = false;
  for (let attempt = 1; attempt <= 5 && !sent; attempt += 1) {
    try {
      const res = await api.tx.Revive.call({
        dest: Binary.fromHex(DIRECTORY),
        value: 0n,
        weight_limit: { ref_time: 900_000_000_000n, proof_size: 3_000_000n },
        storage_deposit_limit: 5n * 10n ** 12n,
        data: Binary.fromHex(data),
      }).signAndSubmit(signer);
      if (res.ok) {
        sent = true;
        done += 1;
        console.log(`  ${label} (${done}/${missing.length})`);
      } else {
        console.error(`  ${label}: ${JSON.stringify(res.dispatchError ?? {}).slice(0, 120)}`);
        break;
      }
    } catch (err) {
      const why = `${err?.message ?? ''}${JSON.stringify(err?.error ?? '')}`;
      if (why.includes('Stale')) {
        await sleep(12_000);
        continue;
      }
      console.error(`  ${label}: ${String(err?.message ?? err).slice(0, 120)}`);
      break;
    }
  }
}

console.log(`\nannounced ${done} of ${missing.length}`);
client.destroy();
