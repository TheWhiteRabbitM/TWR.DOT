/**
 * .dot ecosystem indexer.
 *
 * Enumerating .dot apps is not a contract call: the registry is ENS-style
 * (namehash-keyed mappings) and its events only carry the *hash* of a name, so
 * the plaintext is unrecoverable from events alone. `eth_getLogs` also returns
 * nothing, because contract events surface as Substrate `revive.ContractEmitted`
 * records rather than EVM logs.
 *
 * What actually works, and what this does:
 *   1. Walk blocks, reading `revive.ContractEmitted` events to find the blocks
 *      where the DotNS registry was touched.
 *   2. For those blocks, fetch the RAW block over JSON-RPC and scan the
 *      extrinsic bytes for the plaintext label. Raw bytes are used on purpose:
 *      historical extrinsics cannot be decoded with current metadata once a
 *      runtime upgrade changes call indices.
 *   3. VERIFY every candidate against the registry: a label is admitted only if
 *      `registry.owner(namehash(label + '.dot'))` is non-zero. Step 2 is an
 *      ascii-run scan, so it also picks up byte runs that were never names —
 *      one third of what it found was fictional. Nothing reaches the directory
 *      on the strength of "it looked like a label"; rejects are kept, and
 *      counted, under `excluded` so the UI can disclose them.
 *
 * Output: apps.json — the directory the dotmetrics dashboard consumes.
 *
 *   node index-apps.mjs [--from N] [--to N] [--window N] [--reset]
 *
 * Resumable: the last scanned block is checkpointed, so a periodic run keeps
 * the directory fresh without rescanning history.
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRegistered } from './dotns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'apps.json');
const STATE = path.join(HERE, 'state.json');

const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const REGISTRY = '0x527b08a640b527a3dae0c4be04d7344e430b6e50';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);

/** A .dot label: starts with a letter, 4–63 chars, lowercase alnum + hyphen. */
const LABEL_RE = /^[a-z][a-z0-9-]{3,62}$/;
/** Noise that shows up in block bytes but is never an app. */
const IGNORE = new Set(['aura', 'babe', 'para', 'sudo', 'system', 'timestamp', 'balances']);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const reset = args.includes('--reset');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/** Printable-ascii runs inside a hex blob. */
function asciiRuns(hex, min = 4) {
  const out = [];
  const buf = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  let cur = '';
  for (const b of buf) {
    if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b);
    else {
      if (cur.length >= min) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

async function main() {
  const state = reset ? {} : readJson(STATE, {});
  const previous = reset ? {} : readJson(OUT, {});
  // `excluded` is a top-level list beside the entries, not an entry itself.
  const knownGhosts = Array.isArray(previous.excluded) ? previous.excluded : [];
  delete previous.excluded;
  const apps = previous;

  const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
  const head = (await api.rpc.chain.getHeader()).number.toNumber();

  const to = flag('to', head);
  const from = flag('from', state.lastBlock ? state.lastBlock + 1 : to - flag('window', 8000));

  console.log(`indexing ${from} … ${to}  (head ${head})`);

  let scanned = 0;
  let registryBlocks = 0;
  /** label -> earliest block this run saw it in. Unverified until the pass below. */
  const candidates = new Map();

  async function scanBlock(n) {
    try {
      const hash = await api.rpc.chain.getBlockHash(n);

      // 1. cheap check: did the registry emit anything in this block?
      const at = await api.at(hash);
      const events = await at.query.system.events();
      let touched = false;
      for (const rec of events) {
        if (`${rec.event.section}.${rec.event.method}` !== 'revive.ContractEmitted') continue;
        const d = rec.event.data.toJSON();
        if (String(d[0] ?? '').toLowerCase() === REGISTRY) {
          touched = true;
          break;
        }
      }
      if (!touched) return;
      registryBlocks += 1;

      // 2. plaintext label lives in the raw extrinsic bytes
      const raw = await api._rpcCore.provider.send('chain_getBlock', [hash.toHex()]);
      const extrinsics = raw?.block?.extrinsics ?? [];
      for (let i = 1; i < extrinsics.length; i += 1) {
        // index 0 is the inherent (timestamp/aura); it only carries noise
        for (const run of asciiRuns(extrinsics[i])) {
          const label = run.toLowerCase();
          if (!LABEL_RE.test(label) || IGNORE.has(label)) continue;
          // Candidate only — nothing is announced or admitted until the
          // registry confirms an owner, after the scan.
          candidates.set(label, Math.min(candidates.get(label) ?? n, n));
        }
      }
    } catch {
      /* unreachable block: the next run picks it up */
    } finally {
      scanned += 1;
      if (scanned % 1000 === 0) {
        console.log(
          `  …${scanned} blocks · ${registryBlocks} registry blocks · ${candidates.size} candidates`,
        );
      }
    }
  }

  const queue = [];
  for (let n = from; n <= to; n += 1) queue.push(n);
  while (queue.length) await Promise.all(queue.splice(0, CONCURRENCY).map(scanBlock));

  // ---- verification: the registry decides what is real -------------------
  // Everything is re-checked every run, not just this window's finds: an app
  // can be transferred or dropped, and a label rejected last time can be a
  // genuine registration today.
  // `state.pending` carries candidates whose owner call failed last time. The
  // scan window has moved past their block by now, so without this they would
  // be lost — a real registration dropped because one HTTP request failed.
  const pending = Array.isArray(state.pending) ? state.pending : [];
  const toVerify = [
    ...new Set([...Object.keys(apps), ...candidates.keys(), ...knownGhosts, ...pending]),
  ].sort();
  console.log(`\nverifying ${toVerify.length} labels against registry.owner()…`);
  const { registered, ghosts, failed } = await verifyRegistered(toVerify);

  let discovered = 0;
  for (const [label, owner] of registered) {
    const seenAt = candidates.get(label);
    const existing = apps[label];
    if (!existing) {
      discovered += 1;
      console.log(`  + ${label}.dot  (block ${seenAt ?? '?'})`);
    }
    const seen = [existing?.firstSeenBlock, seenAt].filter((b) => typeof b === 'number' && b > 0);
    const entry = {
      ...existing,
      label,
      domain: `${label}.dot`,
      url: `https://${label}.dev-dot.li`,
      firstSeenBlock: seen.length ? Math.min(...seen) : 0,
      owner,
    };
    // `lastSeenBlock` used to be written here. It was an artifact of the ascii
    // scan (unrelated names shared a value) and no metric may rest on it, so it
    // is dropped rather than carried forward.
    delete entry.lastSeenBlock;
    apps[label] = entry;
  }
  let dropped = 0;
  for (const label of ghosts) {
    if (apps[label]) {
      delete apps[label];
      dropped += 1;
      console.log(`  - ${label}.dot  no owner — never registered`);
    }
  }
  // A label whose owner call FAILED is left exactly as it was: an RPC hiccup
  // is not evidence either way.
  if (failed.length) console.log(`  ? ${failed.length} owner reads failed, left untouched`);

  const out = {};
  for (const label of Object.keys(apps)) out[label] = apps[label];
  // Labels whose check failed keep whatever status they already had, so the
  // disclosed count doesn't flicker with the network.
  const unresolvedGhosts = failed.filter((l) => knownGhosts.includes(l) && !apps[l]);
  out.excluded = [...new Set([...ghosts, ...unresolvedGhosts])].sort();

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  fs.writeFileSync(
    STATE,
    JSON.stringify(
      {
        lastBlock: to,
        updatedAt: new Date().toISOString(),
        registry: REGISTRY,
        rpc: RPC,
        pending: failed,
      },
      null,
      2,
    ),
  );

  console.log(`\nscanned ${scanned} blocks · ${registryBlocks} with registry activity`);
  console.log(
    `registered names: ${Object.keys(apps).length} (+${discovered} new, -${dropped} unregistered) · ` +
      `${out.excluded.length} candidates excluded`,
  );
  for (const a of Object.values(apps).sort((x, y) => x.firstSeenBlock - y.firstSeenBlock)) {
    console.log(`  ${a.domain.padEnd(28)} first seen ${a.firstSeenBlock}`);
  }
  console.log(`\nwrote ${OUT}`);

  await api.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('indexer failed:', e.message ?? e);
  process.exit(1);
});
