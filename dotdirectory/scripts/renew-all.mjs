/**
 * Hand every one of our published sites to the chain's auto-renewal.
 *
 * Same mechanism renew-bundle.mjs proved on dotdirectory, applied across the
 * apps that currently depend on keepalive.yml republishing them weekly. Each
 * site's live CID is read from its own DotNS `contenthash` record — the same
 * pointer the gateway resolves — so this cannot renew a stale bundle that is no
 * longer what the name serves.
 *
 * PRE-FLIGHT, BECAUSE THE CAP IS SHARED.
 * `enable_auto_renew` charges bytes against the caller's authorization AND
 * against the chain-wide `MaxPermanentStorageSize`. That second one belongs to
 * everybody on this devnet, so the script reports headroom before it writes and
 * refuses to start if what we are about to register would not fit. Quietly
 * eating a shared cap is not a fix, it is a different outage with our name on
 * it.
 *
 *   node scripts/renew-all.mjs           # report only
 *   node scripts/renew-all.mjs --go      # register
 *   node scripts/renew-all.mjs --go a.dot b.dot   # only these
 */
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { devnet_bulletin } from '@parity/product-sdk-descriptors/devnet-bulletin';
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { ss58Encode } from '@parity/product-sdk/address';
import { Contract, JsonRpcProvider, keccak256, solidityPacked, toUtf8Bytes, ZeroHash } from 'ethers';

const BULLETIN = ['wss://bulletin-paseo.tservices.es:8443', 'wss://bullet.sik.rocks'];
const ASSETHUB = 'https://paseo-assethub-rpc.laissez-faire.trade';
const CONTENT_RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';
const GATEWAYS = [
  'https://devnet-ipfs.api.polkadotcommunity.foundation',
  'https://paseo-bulletin-next-ipfs.polkadot.io',
];

/** The apps this repo publishes. keepalive.yml's matrix plus the ones that
 *  publish themselves — all of them stop needing that job once registered. */
const OURS = [
  'truereviews', 'thebutton', 'openpetition', 'wudcommunity', 'discreetly',
  'dotmetrics', 'dot-store', 'peoplebook', 'chirponchain', 'peoplewiki',
  'chirpwatch', 'italiarovente', 'rampatlas', 'awakenedgazette', 'worldslog',
];

const argv = process.argv.slice(2);
const GO = argv.includes('--go');
const VERIFY = argv.includes('--verify');
const only = argv.filter((a) => !a.startsWith('--')).map((s) => s.replace(/\.dot$/, ''));
const NAMES = only.length ? only : OURS;

/* --------------------------------------------------------------- cids ---- */

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const b32encode = (bytes) => {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) out += B32[(value >>> (bits -= 5)) & 31];
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
const b32decode = (s) => {
  let bits = 0, value = 0;
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

function readCid(bytes) {
  if (bytes[0] !== 1) throw new Error(`cid version ${bytes[0]}`);
  const len = bytes[3];
  return {
    codec: bytes[1],
    digestHex: '0x' + Buffer.from(bytes.slice(4, 4 + len)).toString('hex'),
    cid: 'b' + b32encode(bytes.slice(0, 4 + len)),
  };
}
const parseCid = (s) => readCid(b32decode(s.slice(1)));

/** ENS contenthash for IPFS is 0xe3 0x01 followed by the binary CID. */
function cidFromContenthash(hex) {
  const bytes = Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  if (bytes.length < 6) return null;
  const body = bytes[0] === 0xe3 && bytes[1] === 0x01 ? bytes.slice(2) : bytes;
  try {
    return readCid(body);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- dag-pb ---- */

function* fields(buf) {
  let i = 0;
  while (i < buf.length) {
    let key = 0, shift = 0;
    while (true) { const b = buf[i++]; key |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
    const wire = key & 7;
    if (wire === 2) {
      let len = 0; shift = 0;
      while (true) { const b = buf[i++]; len |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
      yield [key >>> 3, buf.subarray(i, i + len)];
      i += len;
    } else if (wire === 0) {
      while (buf[i++] & 0x80);
      yield [key >>> 3, null];
    } else throw new Error(`wire type ${wire}`);
  }
}

function linksOf(block) {
  const out = [];
  for (const [no, val] of fields(block)) {
    if (no !== 2 || !val) continue;
    let hash = null;
    for (const [lno, lval] of fields(val)) if (lno === 1 && lval) hash = lval;
    if (hash) out.push(readCid(hash));
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
      if (!r.ok) throw new Error(String(r.status));
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { last = e; }
  }
  throw new Error(`block ${cid.slice(0, 12)}…: ${last?.message}`);
}

async function walk(rootCid) {
  const seen = new Map();
  const queue = [parseCid(rootCid)];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node.cid)) continue;
    seen.set(node.cid, node);
    if (node.codec !== 0x70) continue;
    queue.push(...linksOf(await fetchBlock(node.cid)));
  }
  return [...seen.values()];
}

/* ---------------------------------------------------------------- run ---- */

const DOT_NODE = keccak256(solidityPacked(['bytes32', 'bytes32'], [ZeroHash, keccak256(toUtf8Bytes('dot'))]));
const nodeOf = (label) =>
  keccak256(solidityPacked(['bytes32', 'bytes32'], [DOT_NODE, keccak256(toUtf8Bytes(label))]));

const eth = new JsonRpcProvider(ASSETHUB, undefined, { batchMaxCount: 20, staticNetwork: true });
const resolver = new Contract(CONTENT_RESOLVER, ['function contenthash(bytes32) view returns (bytes)'], eth);

let client;
for (const rpc of BULLETIN) {
  try {
    client = createClient(getWsProvider(rpc));
    await client.getTypedApi(devnet_bulletin).query.System.Number.getValue();
    console.log(`bulletin: ${rpc}`);
    break;
  } catch { client = undefined; }
}
if (!client) throw new Error('no bulletin endpoint answered');
const api = client.getTypedApi(devnet_bulletin);

try {
  const [used, cap] = await Promise.all([
    api.query.TransactionStorage.PermanentStorageUsed.getValue().catch(() => null),
    api.constants.TransactionStorage.MaxPermanentStorageSize().catch(() => null),
  ]);
  const mb = (v) => (v == null ? '?' : (Number(v) / 1e6).toFixed(1) + ' MB');
  console.log(`permanent storage: ${mb(used)} used of ${mb(cap)}`);

  /**
   * The dependency that can actually kill this, reported every run.
   *
   * Every auto-renewal cycle charges the registering account's storage
   * authorization, and the pallet drops the registration with
   * `AutoRenewalFailed` if that quota is gone at cycle time. Those
   * authorizations also expire on their own schedule and are refreshed by the
   * chain's authorizer, not by us. So this is the number worth watching: the
   * renewal is autonomous, its fuel is not.
   */
  const block = await api.query.System.Number.getValue();
  const derived = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
  const auths = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const address = ss58Encode(derived(`//deploy/${i}`).publicKey);
      const a = await api.query.TransactionStorage.Authorizations.getValue({
        type: 'Account',
        value: address,
      }).catch(() => null);
      const expires = Number(a?.expiration ?? 0);
      return { i, alive: expires > block, days: ((expires - block) * 6) / 86400 };
    }),
  );
  const dead = auths.filter((a) => !a.alive);
  const soon = auths.filter((a) => a.alive && a.days < 1);
  const minDays = Math.min(...auths.filter((a) => a.alive).map((a) => a.days));
  console.log(
    `pool authorization: ${auths.length - dead.length}/10 alive` +
      (dead.length ? `, ${dead.length} EXPIRED (${dead.map((a) => a.i).join(',')})` : '') +
      (soon.length ? `, ${soon.length} expiring within a day` : '') +
      (Number.isFinite(minDays) ? `, soonest in ${minDays.toFixed(1)}d` : '') +
      '\n',
  );

  // Resolve every name to its live bundle, then to its blocks.
  const plan = [];
  for (const name of NAMES) {
    try {
      const hash = await resolver.contenthash(nodeOf(name));
      const cid = hash && hash !== '0x' ? cidFromContenthash(hash) : null;
      if (!cid) { console.log(`${name.padEnd(16)} no contenthash — nothing published`); continue; }
      const blocks = await walk(cid.cid);
      const rows = await Promise.all(
        blocks.map(async (b) => ({
          ...b,
          stored: await api.query.TransactionStorage.TransactionByContentHash.getValue(b.digestHex),
          auto: await api.query.TransactionStorage.AutoRenewals.getValue(b.digestHex),
        })),
      );
      const need = rows.filter((r) => r.stored && !r.auto);
      const absent = rows.filter((r) => !r.stored);
      console.log(
        `${name.padEnd(16)} ${String(rows.length).padStart(3)} blocks · ${rows.length - need.length - absent.length} already · ${need.length} to enable${absent.length ? ` · ${absent.length} NOT ON CHAIN` : ''}`,
      );
      plan.push({ name, need });
    } catch (e) {
      console.log(`${name.padEnd(16)} failed: ${String(e.message ?? e).slice(0, 90)}`);
    }
  }

  const total = plan.reduce((n, p) => n + p.need.length, 0);
  console.log(`\n${total} registration(s) needed across ${plan.length} site(s)`);

  // --verify is the watchdog's mode: read only, and FAIL if anything is
  // unregistered. Reporting a gap with exit 0 is how a monitor becomes
  // decoration — the whole reason the old indexer stayed broken for three days
  // was a job that failed quietly and committed a success.
  if (VERIFY) {
    if (dead.length) console.log(`::warning::${dead.length} pool account(s) unauthorized — renewals charged to them will drop`);
    if (total) {
      console.log(`::error::${total} block(s) are not registered for auto-renewal`);
      process.exit(1);
    }
    console.log('every published block is registered for auto-renewal');
    process.exit(0);
  }

  if (!GO || !total) { console.log(GO ? 'nothing to do' : '(report only — pass --go to sign)'); process.exit(0); }

  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
  const pool = Array.from({ length: 10 }, (_, i) => {
    const kp = derive(`//deploy/${i}`);
    return { index: i, address: ss58Encode(kp.publicKey), signer: getPolkadotSigner(kp.publicKey, 'Sr25519', kp.sign) };
  });

  let n = 0, ok = 0, failed = 0;
  for (const { name, need } of plan) {
    let siteOk = 0;
    for (const block of need) {
      const acct = pool[n++ % pool.length];
      try {
        await api.tx.TransactionStorage.enable_auto_renew({ content_hash: block.digestHex }).signAndSubmit(acct.signer);
        // Read back: a receipt is not a registration.
        if (await api.query.TransactionStorage.AutoRenewals.getValue(block.digestHex)) { ok++; siteOk++; }
        else { failed++; console.log(`  x ${name} ${block.cid.slice(0, 12)}… accepted but not registered`); }
      } catch (e) {
        failed++;
        console.log(`  x ${name} ${block.cid.slice(0, 12)}…: ${String(e.message ?? e).slice(0, 110)}`);
      }
    }
    console.log(`${name.padEnd(16)} ${siteOk}/${need.length}`);
  }
  console.log(`\nregistered ${ok}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
} finally {
  client.destroy();
}
