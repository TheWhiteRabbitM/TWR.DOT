import type { ApiPromise } from '@polkadot/api';
import type { Discovered } from './registry';
import { readName, REGISTRY } from './dotns';

/**
 * Real-time registry tail, in the browser.
 *
 * The baked directory is refreshed by the scheduled indexer, but "every N
 * hours" is not live. This module closes the gap the same way the indexer
 * works, client-side: scan the recent block tail for `revive.ContractEmitted`
 * from the DotNS registry, pull those blocks RAW (labels only exist as ascii
 * runs in registration calldata — historical extrinsics don't decode against
 * current metadata), then subscribe to new heads so registrations appear the
 * moment they finalize.
 *
 * The ascii scan is a lead, not a fact: it cannot distinguish a name from a
 * plausible-looking byte run, and a third of what it finds never existed. So
 * nothing is emitted until `registry.owner()` confirms the name — and the same
 * round trip picks up the records, so a name that appears live arrives with the
 * same fields the indexer would have given it.
 *
 * WHY `@polkadot/api` IS PULLED IN WITH A DYNAMIC `import()` BELOW RATHER THAN
 * AT THE TOP OF THIS FILE. It is by far the heaviest thing this app depends on —
 * on its own it was ~1.4 MB of a ~1.5 MB first-load bundle — and nothing the
 * reader sees at first paint needs it: the index renders from the baked
 * snapshot, then swaps in the directory fetched from Bulletin, and both of those
 * reach the page over plain eth_call. This tail is its only caller, it starts
 * strictly after the directory has loaded, and it is an upgrade to a page that
 * is already complete without it. As its own chunk it is fetched once the app is
 * interactive, where the wait costs the reader nothing.
 *
 * The `import type` at the top carries the `ApiPromise` type at zero runtime
 * cost; the values come from the `await import()` inside {@link startLiveTail}.
 */
const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';
/** The address as it appears in `revive.ContractEmitted` data: lowercase hex. */
const REGISTRY_EVENT_SOURCE = REGISTRY.toLowerCase();
const LABEL_RE = /^[a-z][a-z0-9-]{3,62}$/;
const IGNORE = new Set(['aura', 'babe', 'para', 'sudo', 'system', 'timestamp', 'balances']);
/** How far back the browser itself looks on load. The scheduled indexer owns history. */
const TAIL_BLOCKS = 600;

function asciiRuns(hexOrU8: unknown, min = 4): string[] {
  let bytes: Uint8Array;
  if (hexOrU8 instanceof Uint8Array) bytes = hexOrU8;
  else {
    const hex = String(hexOrU8).replace(/^0x/, '');
    bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const out: string[] = [];
  let cur = '';
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b);
    else {
      if (cur.length >= min) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

export interface LiveTail {
  stop(): void;
}

/**
 * Start the live tail. `known` are labels already in the directory; new ones
 * are reported through `onApp` as they are found (tail first, then live).
 * Failures are silent — the baked directory always stands on its own.
 */
export async function startLiveTail(
  known: Set<string>,
  checkpointBlock: number,
  onApp: (app: Discovered) => void,
  onStatus?: (live: boolean) => void,
  /**
   * Every new head, as it lands. The subscription below already receives these
   * and used to drop them on the floor; the top bar's pulse strip is driven by
   * them, so a stalled chain stops the strip instead of a CSS loop pretending
   * otherwise. Fires before block inspection so the tick is not delayed by it.
   */
  onHead?: (block: number) => void,
): Promise<LiveTail> {
  let stopped = false;
  let api: ApiPromise | null = null;
  let unsub: (() => void) | null = null;

  const seen = new Set(known);

  const inspectBlock = async (a: ApiPromise, n: number) => {
    try {
      const hash = await a.rpc.chain.getBlockHash(n);
      const events = (await a.query.system.events.at(hash)) as unknown as {
        event: { section: string; method: string; data: unknown[] };
      }[];
      const touched = [...events].some(
        (r) =>
          r.event.section === 'revive' &&
          r.event.method === 'ContractEmitted' &&
          String(r.event.data[0] ?? '').toLowerCase() === REGISTRY_EVENT_SOURCE,
      );
      if (!touched) return;
      // Raw block: the plaintext label lives only in registration calldata.
      const raw = (await (a as unknown as { _rpcCore: { provider: { send(m: string, p: unknown[]): Promise<unknown> } } })._rpcCore.provider.send(
        'chain_getBlock',
        [hash.toHex()],
      )) as { block?: { extrinsics?: string[] } };
      const extrinsics = raw.block?.extrinsics ?? [];
      const ms = Number((await a.query.timestamp.now.at(hash)).toString());
      for (let i = 1; i < extrinsics.length; i += 1) {
        for (const run of asciiRuns(extrinsics[i])) {
          const label = run.toLowerCase();
          if (!LABEL_RE.test(label) || IGNORE.has(label) || seen.has(label)) continue;
          // Claim the label before the await so two extrinsics in flight can't
          // both verify it.
          seen.add(label);
          let records;
          try {
            records = await readName(label);
          } catch {
            // The check itself failed — that says nothing about the name, so
            // release it and try again the next time it is sighted.
            seen.delete(label);
            continue;
          }
          // A confirmed zero owner: an ascii coincidence, not a registration.
          // It stays in `seen`, so it is never re-checked.
          if (!records) continue;
          onApp({
            label,
            domain: `${label}.dot`,
            url: `https://${label}.dev-dot.li`,
            firstSeenBlock: n,
            firstSeenAt: Math.floor(ms / 1000),
            ...records,
          });
        }
      }
    } catch {
      /* single-block failures never kill the tail */
    }
  };

  void (async () => {
    try {
      // The one place the heavy dependency is paid for, and only once the
      // caller has decided it wants a tail at all.
      const { ApiPromise, WsProvider } = await import('@polkadot/api');
      api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
      if (stopped) return void api.disconnect();
      const head = (await api.rpc.chain.getHeader()).number.toNumber();
      onStatus?.(true);

      // Catch-up tail: from the baked checkpoint, capped — history is the
      // scheduled indexer's job, the browser only closes the recent gap.
      const from = Math.max(checkpointBlock + 1, head - TAIL_BLOCKS);
      const QUEUE = 6;
      let next = from;
      const workers = Array.from({ length: QUEUE }, async () => {
        while (!stopped && next <= head) {
          const n = next;
          next += 1;
          await inspectBlock(api!, n);
        }
      });
      await Promise.all(workers);

      if (stopped) return;
      // …and from here on, true real-time: every new head is inspected as it lands.
      unsub = (await api.rpc.chain.subscribeNewHeads((h) => {
        const n = h.number.toNumber();
        onHead?.(n);
        void inspectBlock(api!, n);
      })) as unknown as () => void;
    } catch (error) {
      // Two different failures land here and the reader is owed the difference:
      // the tail's own code failing to download (offline, a chunk that 404s
      // behind a stale service worker) and the node refusing the socket. Both
      // mean "no live feed", which is what onStatus reports, but only the log
      // can say which — so it says it in a full sentence rather than dumping a
      // stack.
      console.warn(
        '[live-tail] no live registrations feed:',
        error instanceof Error ? error.message : String(error),
        `— the directory on the page is the last indexed snapshot and is still correct, ` +
          `it just stops growing until ${RPC} answers again.`,
      );
      onStatus?.(false);
    }
  })();

  return {
    stop() {
      stopped = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      void api?.disconnect().catch(() => {});
    },
  };
}
