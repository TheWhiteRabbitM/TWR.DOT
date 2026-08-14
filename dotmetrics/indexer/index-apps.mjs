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
 * Resumable and bounded: the scan checkpoints every CHECKPOINT_EVERY blocks, and
 * one run advances at most MAX_SPAN blocks unless --to says otherwise. Both
 * matter together — a run that is killed partway now keeps what it walked, so
 * the backlog shrinks even when the job does not finish. Before that, a kill
 * discarded the whole run and the next one restarted from the same block with
 * more chain to cover, which is how the indexer stalled for three days in
 * August 2026 behind a workflow timeout that GitHub reports as "cancelled".
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

/**
 * Most blocks one run will scan by default. Without a ceiling the range is
 * `lastBlock+1 … head`, which is fine while the job keeps up and fatal once it
 * does not: a run killed by the workflow timeout wrote no checkpoint, so the
 * next run inherited the same backlog plus another hour of chain, and each
 * failure made the next failure more certain. An explicit --to overrides.
 *
 * The size is measured, not guessed. The scan runs at ~18 blocks/second against
 * a public RPC, so 20,000 blocks is ~18.5 minutes of scanning; add the seven
 * other scripts in the same workflow step (~12 minutes) and the job landed at
 * ~30.5 against a 30-minute timeout — which is why the first attempt at this fix
 * died at 30.3 minutes with clockwork regularity. 6,000 blocks is ~5.5 minutes
 * of scanning and leaves the step comfortably inside the ceiling, so it FINISHES
 * and its state gets committed. At 24 runs a day that is ~144k blocks against
 * ~41k of accrual: a backlog shrinks by ~100k a day instead of growing.
 */
const MAX_SPAN = Number(process.env.MAX_SPAN ?? 6_000);
/** Blocks between checkpoints — the work a timeout kill can cost us. */
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY ?? 2_000);

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

/**
 * Merge a patch into state.json, spread over the CURRENT file re-read at write
 * time: state.json also carries the directory-upload and site-publish
 * bookkeeping written by directory-digest.mjs and app-tree-hash.mjs, and
 * neither an ordinary run nor --reset (which resets the SCAN, not the publish
 * history) may drop it.
 */
const saveState = (patch) =>
  fs.writeFileSync(STATE, JSON.stringify({ ...readJson(STATE, {}), ...patch }, null, 2) + '\n');

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

  const from = flag('from', state.lastBlock ? state.lastBlock + 1 : head - flag('window', 8000));
  // Cap the default span. `from` no longer derives from `to` — it is where the
  // last run actually got to, and `to` is however far we can responsibly reach
  // from there this run.
  const explicitTo = flag('to', null);
  const to = explicitTo ?? Math.min(head, from + MAX_SPAN - 1);
  const backlog = head - to;

  console.log(
    `indexing ${from} … ${to}  (head ${head}${backlog > 0 ? `, ${backlog} still behind` : ''})`,
  );

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

  // Scan in chunks and checkpoint after each one. The verification pass below
  // is what admits a candidate, and it runs only once the whole range is walked
  // — so a checkpoint advances `lastBlock` past blocks whose candidates are not
  // yet verified. Those go into `pending`, which exists for exactly this case
  // and is re-verified next run, so nothing found is lost if we are killed.
  const carried = Array.isArray(state.pending) ? state.pending : [];
  for (let start = from; start <= to; start += CHECKPOINT_EVERY) {
    const end = Math.min(start + CHECKPOINT_EVERY - 1, to);
    const queue = [];
    for (let n = start; n <= end; n += 1) queue.push(n);
    while (queue.length) await Promise.all(queue.splice(0, CONCURRENCY).map(scanBlock));

    saveState({
      lastBlock: end,
      updatedAt: new Date().toISOString(),
      registry: REGISTRY,
      rpc: RPC,
      pending: [...new Set([...carried, ...candidates.keys()])],
    });
    if (end < to) console.log(`  checkpoint @ ${end}`);
  }

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
  // Every candidate in the scanned range has now been verified, so `pending`
  // drops back to just the owner reads that failed.
  saveState({
    lastBlock: to,
    updatedAt: new Date().toISOString(),
    registry: REGISTRY,
    rpc: RPC,
    pending: failed,
  });

  // A timeout kill is reported by GitHub as "cancelled", not "failure", so a
  // stalled indexer raises no alarm on its own. Say it out loud instead.
  if (backlog > 0) {
    console.log(
      `::warning title=dotmetrics indexer behind::${backlog} blocks behind head ` +
        `(at ${to}, head ${head}) — closing up to ${MAX_SPAN} per run`,
    );
  }

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
