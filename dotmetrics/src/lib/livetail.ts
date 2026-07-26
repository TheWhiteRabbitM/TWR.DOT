import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Discovered } from './registry';

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
 */
const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';
const REGISTRY = '0x527b08a640b527a3dae0c4be04d7344e430b6e50';
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
          String(r.event.data[0] ?? '').toLowerCase() === REGISTRY,
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
          seen.add(label);
          onApp({
            label,
            domain: `${label}.dot`,
            url: `https://${label}.dev-dot.li`,
            firstSeenBlock: n,
            lastSeenBlock: n,
            firstSeenAt: Math.floor(ms / 1000),
          });
        }
      }
    } catch {
      /* single-block failures never kill the tail */
    }
  };

  void (async () => {
    try {
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
        void inspectBlock(api!, h.number.toNumber());
      })) as unknown as () => void;
    } catch {
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
