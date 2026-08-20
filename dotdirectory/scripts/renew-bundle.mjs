/**
 * Auto-renew a WHOLE published bundle, not just its root.
 *
 * `pad` does not store a site as one blob. It stores every file (and every
 * chunk of a large file) as its own Bulletin transaction and then stores a
 * dag-pb node linking them — so `enable_auto_renew` on the root CID keeps the
 * index alive while the JavaScript it points at expires underneath it. That
 * failure would look like a working renewal right up until the page 404s on
 * its own assets, which is the worst kind: a green light on a dead thing.
 *
 * So the DAG is walked and every block that the chain holds separately gets its
 * own registration. Feeless — the cost is authorization quota, not tokens.
 *
 *   node scripts/renew-bundle.mjs <root-cid> [--go]
 */
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { devnet_bulletin } from '@parity/product-sdk-descriptors/devnet-bulletin';
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { ss58Encode } from '@parity/product-sdk/address';

const RPCS = ['wss://bulletin-paseo.tservices.es:8443', 'wss://bullet.sik.rocks'];
const GATEWAYS = [
  'https://devnet-ipfs.api.polkadotcommunity.foundation',
  'https://paseo-bulletin-next-ipfs.polkadot.io',
];
const args = process.argv.slice(2);
const GO = args.includes('--go');
const ROOT = args.find((a) => !a.startsWith('--'));
if (!ROOT) throw new Error('usage: node scripts/renew-bundle.mjs <root-cid> [--go]');

/* ---------------------------------------------------------------- CID ---- */

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const b32decode = (s) => {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) out.push((value >> (bits -= 8)) & 0xff);
  }
  return Uint8Array.from(out);
};
const b32encode = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) out += B32[(value >>> (bits -= 5)) & 31];
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

/** Binary CIDv1 → { digestHex, codec, cidString }. All varints are one byte at
 *  these values (v1, dag-pb 0x70 / raw 0x55, sha2-256 0x12, len 32). */
function readCid(bytes) {
  if (bytes[0] !== 1) throw new Error(`cid version ${bytes[0]}`);
  const codec = bytes[1];
  const len = bytes[3];
  return {
    codec,
    digestHex: '0x' + Buffer.from(bytes.slice(4, 4 + len)).toString('hex'),
    cid: 'b' + b32encode(bytes.slice(0, 4 + len)),
  };
}
const parseCid = (s) => readCid(b32decode(s.slice(1)));

/* ------------------------------------------------------------- dag-pb ---- */

/** Minimal protobuf: enough for PBNode{Links=2} and PBLink{Hash=1,Name=2}. */
function* fields(buf) {
  let i = 0;
  while (i < buf.length) {
    let key = 0;
    let shift = 0;
    while (true) {
      const b = buf[i++];
      key |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    const no = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
      let len = 0;
      shift = 0;
      while (true) {
        const b = buf[i++];
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      yield [no, buf.subarray(i, i + len)];
      i += len;
    } else if (wire === 0) {
      while (buf[i++] & 0x80);
      yield [no, null];
    } else throw new Error(`wire type ${wire}`);
  }
}

function linksOf(block) {
  const out = [];
  for (const [no, val] of fields(block)) {
    if (no !== 2 || !val) continue;
    let hash = null;
    let name = '';
    for (const [lno, lval] of fields(val)) {
      if (lno === 1 && lval) hash = lval;
      if (lno === 2 && lval) name = Buffer.from(lval).toString('utf8');
    }
    if (hash) out.push({ ...readCid(hash), name });
  }
  return out;
}

async function fetchBlock(cid) {
  let last;
  for (const g of GATEWAYS) {
    try {
      const r = await fetch(`${g}/ipfs/${cid}?format=raw`, {
        headers: { accept: 'application/vnd.ipld.raw' },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`could not fetch block ${cid}: ${last?.message}`);
}

/* ---------------------------------------------------------------- run ---- */

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
  // Walk the DAG breadth-first. dag-pb nodes have children; raw blocks do not.
  const seen = new Map();
  const queue = [{ ...parseCid(ROOT), name: '(root)' }];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node.cid)) continue;
    seen.set(node.cid, node);
    if (node.codec !== 0x70) continue;
    try {
      queue.push(...linksOf(await fetchBlock(node.cid)));
    } catch (e) {
      console.log(`  ! could not walk ${node.name}: ${e.message}`);
    }
  }
  console.log(`bundle: ${seen.size} block(s)`);

  const rows = [];
  for (const node of seen.values()) {
    const [at, auto] = await Promise.all([
      api.query.TransactionStorage.TransactionByContentHash.getValue(node.digestHex),
      api.query.TransactionStorage.AutoRenewals.getValue(node.digestHex),
    ]);
    rows.push({ ...node, stored: at ? `${at[0]}/${at[1]}` : null, auto: auto ?? null });
  }

  const stored = rows.filter((r) => r.stored);
  const missing = rows.filter((r) => !r.stored);
  const need = stored.filter((r) => !r.auto);
  console.log(`stored on chain: ${stored.length}   not found: ${missing.length}`);
  console.log(`already auto-renewing: ${stored.length - need.length}   to enable: ${need.length}`);
  for (const r of rows) {
    console.log(
      `  ${r.stored ? 'stored ' : 'ABSENT '} ${r.auto ? 'auto' : '    '}  ${r.cid.slice(0, 14)}…  ${r.name || '(root)'}`,
    );
  }

  if (!GO || !need.length) {
    console.log(need.length ? '\n(report only — pass --go to sign)' : '\nnothing to enable');
    process.exit(0);
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

  // Spread the registrations across the pool: every cycle charges the owning
  // account's quota forever, so putting a whole bundle on one account is how a
  // single exhausted authorization takes the whole site down at once.
  let ok = 0;
  for (const [n, r] of need.entries()) {
    const acct = pool[n % pool.length];
    try {
      const res = await api.tx.TransactionStorage.enable_auto_renew({
        content_hash: r.digestHex,
      }).signAndSubmit(acct.signer);
      const back = await api.query.TransactionStorage.AutoRenewals.getValue(r.digestHex);
      if (res.ok && back) {
        ok++;
        console.log(`  + ${r.name || '(root)'} → pool[${acct.index}]`);
      } else {
        console.log(`  x ${r.name || '(root)'}: ${JSON.stringify(res.dispatchError ?? 'no read-back').slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`  x ${r.name || '(root)'}: ${String(e.message ?? e).slice(0, 120)}`);
    }
  }
  console.log(`\nenabled ${ok}/${need.length}`);
  process.exit(ok === need.length ? 0 : 1);
} finally {
  client.destroy();
}
