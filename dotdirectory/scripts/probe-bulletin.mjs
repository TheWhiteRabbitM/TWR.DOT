/**
 * What Bulletin actually offers for keeping a bundle alive.
 *
 * The weekly republish in keepalive.yml was built on the belief, written into
 * its own header, that "renewing means re-publishing — there is no renew verb".
 * That is true of the CLI and false of the chain: the runtime carries `renew`,
 * `force_renew` and `enable_auto_renew`, the last being a recurring scheduler
 * the chain drives itself. This script checks that against the live devnet
 * rather than against the type definitions, because a call existing in metadata
 * says nothing about whether our data is eligible or our accounts may use it.
 *
 * Reads only. Nothing here signs anything.
 */
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { devnet_bulletin } from '@parity/product-sdk-descriptors/devnet-bulletin';
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { ss58Encode } from '@parity/product-sdk/address';

const RPCS = ['wss://bulletin-paseo.tservices.es:8443', 'wss://bullet.sik.rocks'];
const CID = process.argv[2] ?? 'bafybeibin3ppw4ojobjav2wk3dqibdjnthvcer3uqqjpxvinjq6njpe37e';

/** base32 (RFC4648 lower, no padding) — the multibase 'b' CIDv1 alphabet. */
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32Decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** CIDv1 is <version><codec><multihash>; the multihash is <code><len><digest>. */
function digestOf(cid) {
  if (!cid.startsWith('b')) throw new Error('expected a base32 CIDv1');
  const bytes = base32Decode(cid.slice(1));
  // varints here are all single-byte in practice (version 1, codec 0x70/0x55,
  // hash 0x12, length 32) — assert rather than implement a varint reader.
  const [version, codec, hashCode, len] = bytes;
  if (version !== 1) throw new Error(`cid version ${version}`);
  const digest = bytes.slice(4, 4 + len);
  return { codec, hashCode, len, digest, hex: '0x' + Buffer.from(digest).toString('hex') };
}

const poolAccounts = (() => {
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
  return Array.from({ length: 10 }, (_, i) => {
    const kp = derive(`//deploy/${i}`);
    return { index: i, address: ss58Encode(kp.publicKey) };
  });
})();

async function connect() {
  let last;
  for (const rpc of RPCS) {
    try {
      const client = createClient(getWsProvider(rpc));
      const api = client.getTypedApi(devnet_bulletin);
      // Prove the connection before handing it back: getWsProvider resolves
      // eagerly and a dead endpoint only shows up on the first real query.
      await api.query.System.Number.getValue();
      return { client, api, rpc };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`no bulletin endpoint answered: ${last?.message}`);
}

const { client, api, rpc } = await connect();
try {
  const d = digestOf(CID);
  const block = await api.query.System.Number.getValue();
  const [retention, byteFee, entryFee, located, auto] = await Promise.all([
    api.query.TransactionStorage.RetentionPeriod.getValue(),
    api.query.TransactionStorage.ByteFee.getValue().catch(() => null),
    api.query.TransactionStorage.EntryFee.getValue().catch(() => null),
    api.query.TransactionStorage.TransactionByContentHash.getValue(d.hex).catch((e) => ({
      error: String(e).slice(0, 120),
    })),
    api.query.TransactionStorage.AutoRenewals.getValue(d.hex).catch((e) => ({
      error: String(e).slice(0, 120),
    })),
  ]);

  console.log(JSON.stringify(
    {
      rpc,
      block,
      cid: CID,
      contentHash: d.hex,
      cidCodec: '0x' + d.codec.toString(16),
      retentionPeriodBlocks: retention,
      retentionDaysAt6s: retention ? +((retention * 6) / 86400).toFixed(2) : null,
      byteFee,
      entryFee,
      storedAt: located,
      autoRenewal: auto,
    },
    (_k, v) => (typeof v === 'bigint' ? String(v) : v),
    2,
  ));

  const auths = await Promise.all(
    poolAccounts.map(async (a) => {
      const v = await api.query.TransactionStorage.Authorizations.getValue({
        type: 'Account',
        value: a.address,
      }).catch((e) => ({ error: String(e).slice(0, 80) }));
      return { ...a, auth: v };
    }),
  );
  console.log(
    'pool:',
    JSON.stringify(
      auths.map((a) => ({
        i: a.index,
        expires: a.auth?.expiration ?? null,
        alive: a.auth ? Number(a.auth.expiration ?? 0) > block : false,
        txs: a.auth?.transactions ?? null,
        bytes: a.auth?.bytes ?? null,
      })),
      (_k, v) => (typeof v === 'bigint' ? String(v) : v),
    ),
  );
} finally {
  client.destroy();
}
