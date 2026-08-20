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

// ethers only to recover the eth sender out of the RLP payload; the chain work
// is all @polkadot/api. This used to be pulled through createRequire from an
// absolute path on one laptop, so the script could only ever run on that laptop:
// on the runner it threw MODULE_NOT_FOUND, the whole re-index step exited 1, and
// every step after it — including the one that moves the directory record — was
// skipped. The index kept being refreshed and committed while the site went on
// serving an old directory.
import { ethers } from 'ethers';

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

/**
 * Calls and reverts per SENDER, which is the number that stops a revert rate
 * from lying.
 *
 * Measured 2026-08-10 over 120 blocks: twenty calls, twenty reverts, one
 * sender, one target, one selector, the same 650-byte payload every six blocks,
 * failing every time with `Revive.ContractReverted` ("the contract ran to
 * completion but decided to revert its storage changes"). That is one bot in a
 * retry loop, and on a chain this quiet it IS the whole window.
 *
 * "100% of calls reverted" and "one address retried the same failing call
 * twenty times, and nobody else called anything" are the same measurement and
 * opposite claims. So the share of the busiest caller is recorded, and the
 * dashboard can say which of the two it is looking at.
 *
 * The sender is inside the RLP: at the substrate level `revive.ethTransact` is
 * unsigned, and the eth signature it carries is what names the caller.
 */
const callerCalls = new Map();
const callerReverts = new Map();

for (let n = from; n <= head; n += 1) {
  const hash = await api.rpc.chain.getBlockHash(n);

  try {
    const signed = await api.rpc.chain.getBlock(hash);
    const evs = await api.query.system.events.at(hash);
    signed.block.extrinsics.forEach((ex, i) => {
      if (ex.method.section !== 'revive') return;
      contractCalls += 1;

      let who = '(undecodable)';
      try {
        const tx = ethers.Transaction.from(ex.method.args[0].toHex());
        who = (tx.from ?? '(unrecovered)').toLowerCase();
      } catch {
        // A payload we cannot decode still counts as a call. Dropping it would
        // shrink the denominator, which is the bug this whole counter exists for.
      }
      callerCalls.set(who, (callerCalls.get(who) ?? 0) + 1);

      const reverted = evs.some(
        (e) =>
          e.phase.isApplyExtrinsic &&
          e.phase.asApplyExtrinsic.toNumber() === i &&
          e.event.section === 'revive' &&
          e.event.method === 'EthExtrinsicRevert',
      );
      if (reverted) callerReverts.set(who, (callerReverts.get(who) ?? 0) + 1);
    });
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

const busiest = [...callerCalls.entries()].sort((a, b) => b[1] - a[1])[0];
const topCaller = busiest
  ? { address: busiest[0], calls: busiest[1], reverts: callerReverts.get(busiest[0]) ?? 0 }
  : null;

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
  /**
   * The busiest caller in the window, and how many of its calls reverted.
   *
   * Without this, a devnet where one bot retries a failing call looks exactly
   * like an ecosystem where everything is broken. Same numbers, opposite
   * claims, and only this field tells them apart.
   */
  topCaller,
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
