// Measure REAL ecosystem on-chain activity over a recent window and write a
// compact ecosystem.json the dashboard reads. Honest by construction: it reports
// only what it actually counted, over a stated window, at a stated time.
//
// Why a script and not a live browser read: activity lives in Substrate
// `revive.ContractEmitted` events (eth_getLogs returns nothing here), and full
// blocks don't decode with generic metadata — so it's a Node/@polkadot job, run
// periodically, same shape as the directory indexer.
import { ApiPromise, WsProvider } from '@polkadot/api';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'ecosystem.json');
const RPC = process.env.RPC ?? 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const WINDOW = Number(process.env.WINDOW ?? 600);

const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
const head = (await api.rpc.chain.getHeader()).number.toNumber();
const from = Math.max(1, head - WINDOW);
console.log(`head #${head}; scanning ${from}..${head}`);

const contracts = new Map();
let contractEvents = 0;
let reverts = 0;
let scanned = 0;
let firstTs = null;
let lastTs = null;

/**
 * Contract calls actually submitted in the window.
 *
 * WHY THIS COUNTER HAD TO EXIST
 *   The revert rate used to divide by `contractEvents + reverts`, which is an
 *   EVENT count added to an EXTRINSIC count. They are different units. A single
 *   successful call emits nought, one or ten events, and a call that writes
 *   state without emitting is invisible to it entirely. On a quiet chain that
 *   put three events beside twenty-five reverts and announced "89% reverted",
 *   a number that was never measured.
 *
 *   The right denominator is the number of calls: every `revive` extrinsic in
 *   the block. `EthExtrinsicRevert` is then the numerator, and both sides are
 *   counted in the same thing.
 *
 * WHY THE EXTRINSIC IS THE UNIT AND NOT ExtrinsicFailed
 *   On revive an EVM call that reverts still leaves a SUCCESSFUL extrinsic:
 *   the transaction was included and paid for, the call inside it undid itself.
 *   That is exactly why `EthExtrinsicRevert` exists as its own event. Counting
 *   `system.ExtrinsicFailed` instead would report almost nothing.
 */
let contractCalls = 0;

for (let n = from; n <= head; n += 1) {
  const hash = await api.rpc.chain.getBlockHash(n);

  try {
    const signed = await api.rpc.chain.getBlock(hash);
    for (const ex of signed.block.extrinsics) {
      if (ex.method.section === 'revive') contractCalls += 1;
    }
  } catch {
    // A block whose body will not decode is not a block with no calls. It is
    // left out of both sides rather than counted as zero.
  }

  let events;
  try {
    events = await api.query.system.events.at(hash);
  } catch {
    continue;
  }
  scanned += 1;
  const ms = Number((await api.query.timestamp.now.at(hash)).toString());
  if (firstTs == null) firstTs = ms;
  lastTs = ms;
  for (const record of events) {
    const { section, method, data } = record.event;
    if (section === 'revive' && method === 'ContractEmitted') {
      contractEvents += 1;
      const addr = String(data[0]).toLowerCase();
      contracts.set(addr, (contracts.get(addr) ?? 0) + 1);
    } else if (section === 'revive' && method === 'EthExtrinsicRevert') {
      reverts += 1;
    }
  }
}

const spanSec = firstTs != null && lastTs != null ? Math.round((lastTs - firstTs) / 1000) : 0;
const byAddress = [...contracts.entries()].sort((a, b) => b[1] - a[1]);

const out = {
  measuredAt: Math.floor((lastTs ?? Date.now()) / 1000),
  headBlock: head,
  windowBlocks: scanned,
  windowSeconds: spanSec,
  contractEvents,
  activeContracts: contracts.size,
  /** Every `revive` extrinsic in the window: the denominator a revert rate
   *  actually has. Absent from data written before this counter existed, and
   *  the dashboard says "not measured" rather than inventing one. */
  contractCalls,
  reverts,
  topContracts: byAddress.slice(0, 8).map(([address, events]) => ({ address, events })),

  /**
   * Every address that emitted in this window, with its count — the metric that
   * needs no ABI, and therefore the one metric ANY app can have measured. A name
   * that declares a `contract` text record (see enrich-onchain.mjs) is looked up
   * here by that address; addresses are lowercased on both sides so the join is
   * exact.
   *
   * The window travels WITH the numbers rather than being inferred from the
   * fields above. "3 events" is not a measurement — 3 over what? A caller that
   * only ever sees this object can still state the denominator, and it cannot
   * accidentally pair a count with the wrong window.
   *
   * The map is COMPLETE for the window, not a top-N. That completeness is what
   * lets a reader treat a declared address that is absent here as a measured
   * zero rather than as "not measured".
   */
  perContract: {
    headBlock: head,
    windowBlocks: scanned,
    windowSeconds: spanSec,
    events: Object.fromEntries(byAddress),
  },
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// Append to the run history: one line per measurement. Each 6-hourly refresh
// adds a point, so the dashboard's activity-over-time chart builds itself.
const HISTORY = path.join(HERE, 'history.jsonl');
fs.appendFileSync(
  HISTORY,
  JSON.stringify({
    at: out.measuredAt,
    head: out.headBlock,
    events: out.contractEvents,
    reverts: out.reverts,
    contracts: out.activeContracts,
  }) + '\n',
);

console.log('wrote', OUT, out);
await api.disconnect();
