/**
 * Hand the renewal to the chain.
 *
 * Bulletin's runtime carries `enable_auto_renew`: a recurring scheduler that
 * re-stores a piece of data at every RetentionPeriod boundary, driven by the
 * chain's own `on_initialize` and an inherent, with no caller, no cron and no
 * runner. It is feeless — the cost is charged against the calling account's
 * storage authorization (tx slots and bytes), not a balance — which is why no
 * amount of money could have bought what one call gets for free.
 *
 * The keys are public by construction. `pad` derives its Bulletin storage pool
 * from DEV_PHRASE at //deploy/0…9 (see polkadot-app-deploy/dist/pool.ts:
 * `derivePoolAccounts(poolSize = 10, mnemonic = DEV_PHRASE)`), so this needs no
 * secret of ours and could equally run in a visitor's browser.
 *
 *   node scripts/auto-renew.mjs <cid> [--go]
 *
 * Without --go it only reports. With --go it signs.
 */
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { devnet_bulletin } from '@parity/product-sdk-descriptors/devnet-bulletin';
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { ss58Encode } from '@parity/product-sdk/address';

const RPCS = ['wss://bulletin-paseo.tservices.es:8443', 'wss://bullet.sik.rocks'];
const args = process.argv.slice(2);
const GO = args.includes('--go');
const CID = args.find((a) => !a.startsWith('--'));
if (!CID) throw new Error('usage: node scripts/auto-renew.mjs <cid> [--go]');

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function digestOf(cid) {
  if (!cid.startsWith('b')) throw new Error('expected a base32 CIDv1');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of cid.slice(1)) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  if (bytes[0] !== 1) throw new Error(`cid version ${bytes[0]}`);
  return '0x' + Buffer.from(bytes.slice(4, 4 + bytes[3])).toString('hex');
}

const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
const pool = Array.from({ length: 10 }, (_, i) => {
  const kp = derive(`//deploy/${i}`);
  return {
    index: i,
    address: ss58Encode(kp.publicKey),
    signer: getPolkadotSigner(kp.publicKey, 'Sr25519', kp.sign),
  };
});

let client;
for (const rpc of RPCS) {
  try {
    client = createClient(getWsProvider(rpc));
    await client.getTypedApi(devnet_bulletin).query.System.Number.getValue();
    console.log(`connected: ${rpc}`);
    break;
  } catch {
    client = undefined;
  }
}
if (!client) throw new Error('no bulletin endpoint answered');
const api = client.getTypedApi(devnet_bulletin);

try {
  const hash = digestOf(CID);
  const at = await api.query.TransactionStorage.TransactionByContentHash.getValue(hash);
  const already = await api.query.TransactionStorage.AutoRenewals.getValue(hash);
  console.log(`content hash: ${hash}`);
  console.log(`stored at:    ${at ? `block ${at[0]}, index ${at[1]}` : 'NOT STORED'}`);
  console.log(`auto-renewal: ${already ? JSON.stringify(already) : 'none'}`);
  if (!at) throw new Error('this CID is not stored on this chain — nothing to renew');
  if (already) {
    console.log('already scheduled; nothing to do');
    process.exit(0);
  }
  if (!GO) {
    console.log('\n(report only — pass --go to sign)');
    process.exit(0);
  }

  // Which pool account may enable it is the open question, so try them in turn
  // and let the chain answer rather than guessing from the docs.
  for (const acct of pool) {
    try {
      const tx = api.tx.TransactionStorage.enable_auto_renew({ content_hash: hash });
      const r = await tx.signAndSubmit(acct.signer);
      if (r.ok) {
        console.log(`\nenabled by pool[${acct.index}] ${acct.address}`);
        console.log(`block ${r.block?.hash ?? '?'}`);
        const back = await api.query.TransactionStorage.AutoRenewals.getValue(hash);
        console.log(`read back: ${JSON.stringify(back)}`);
        process.exit(back ? 0 : 1);
      }
      console.log(`pool[${acct.index}] dispatch failed: ${JSON.stringify(r.dispatchError ?? r).slice(0, 160)}`);
    } catch (e) {
      console.log(`pool[${acct.index}] rejected: ${String(e.message ?? e).slice(0, 160)}`);
    }
  }
  console.log('\nno pool account could enable it');
  process.exit(1);
} finally {
  client.destroy();
}
