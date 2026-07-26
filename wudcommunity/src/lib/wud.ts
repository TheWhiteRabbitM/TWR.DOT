import { ApiPromise, HttpProvider, WsProvider } from '@polkadot/api';

/**
 * $WUD lives on Polkadot Asset Hub as asset 31337 — mainnet, not the devnet
 * this dashboard is published to. Everything here is a public read: no wallet,
 * no signing, no account.
 */
export const ASSET_ID = 31337;

/**
 * Public Asset Hub nodes, raced in parallel rather than tried in order.
 * Which ones answer varies by network, hour and browser: a measurement from one
 * machine had seven of these refuse the socket outright and the survivor take
 * 5.5s to hand shake, so a short serial walk down the list reliably gave up
 * before the one working node had finished connecting. HTTPS entries are in the
 * race too — they get through some networks that block WebSockets, and every
 * read here is a one-shot query that needs no subscription.
 */
const ENDPOINTS = [
  'wss://rpc-asset-hub-polkadot.luckyfriday.io',
  'wss://polkadot-asset-hub-rpc.polkadot.io',
  'wss://sys.ibp.network/asset-hub-polkadot',
  'wss://asset-hub-polkadot.dotters.network',
  'wss://polkadot-asset-hub-rpc.dwellir.com',
  'wss://asset-hub-polkadot-rpc.dwellir.com',
  'https://polkadot-asset-hub-rpc.polkadot.io',
  'https://rpc-asset-hub-polkadot.luckyfriday.io',
];

const CONNECT_TIMEOUT_MS = 20_000;
/** WebSocket endpoints start in small waves; opening them all at once earns 429s. */
const WAVE_SIZE = 3;
const WAVE_DELAY_MS = 2_500;
/**
 * HTTPS is the fallback for networks that block WebSockets, so it must not fire
 * while a socket is still handshaking — a healthy node took 5.5s in testing, and
 * an HTTPS wave at 5s just collected rate-limit errors nobody needed.
 */
const HTTP_DELAY_MS = 9_000;

export interface WudStats {
  name: string;
  symbol: string;
  decimals: number;
  /** Raw supply in planck-style base units. */
  supplyRaw: bigint;
  /** Supply in whole tokens. */
  supply: number;
  holders: number;
  status: string;
  owner: string;
  admin: string;
  issuer: string;
  freezer: string;
  /** True when every authority is the same account. */
  singleAuthority: boolean;
  endpoint: string;
  fetchedAt: number;
}

let api: ApiPromise | null = null;
let endpointUsed = '';
let connecting: Promise<ApiPromise> | null = null;

type Attempt = { api: ApiPromise; endpoint: string };

function open(endpoint: string): Promise<Attempt> {
  // `false` disables auto-reconnect so a dead node rejects instead of retrying
  // forever and holding a slot in the race.
  const provider = endpoint.startsWith('http')
    ? new HttpProvider(endpoint)
    : new WsProvider(endpoint, false);
  return ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true }).then((a) => ({
    api: a,
    endpoint,
  }));
}

async function race(): Promise<ApiPromise> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const attempts: Promise<Attempt>[] = [];
  let done = false;

  const first = new Promise<Attempt>((resolve, reject) => {
    let failed = 0;
    const giveUp = () => {
      if (done) return;
      done = true;
      reject(new Error('no public Asset Hub node answered'));
    };

    const launch = (endpoint: string) => {
      if (done) return;
      const attempt = open(endpoint);
      attempts.push(attempt);
      attempt.then(
        (r) => {
          // A node that finishes after the race is decided is just a stray socket.
          if (done) return void r.api.disconnect();
          done = true;
          resolve(r);
        },
        () => {
          failed += 1;
          if (failed === ENDPOINTS.length) giveUp();
        },
      );
    };

    ENDPOINTS.forEach((endpoint, i) => {
      const delay = endpoint.startsWith('http')
        ? HTTP_DELAY_MS
        : Math.floor(i / WAVE_SIZE) * WAVE_DELAY_MS;
      if (delay === 0) launch(endpoint);
      else timers.push(setTimeout(() => launch(endpoint), delay));
    });
    timers.push(setTimeout(giveUp, CONNECT_TIMEOUT_MS));
  });

  // Whoever loses still holds an open socket; close them all.
  const closeOthers = (winner: ApiPromise | null) => {
    for (const attempt of attempts) {
      attempt.then((r) => (r.api === winner ? undefined : r.api.disconnect())).catch(() => {});
    }
  };

  try {
    const winner = await first;
    closeOthers(winner.api);
    api = winner.api;
    endpointUsed = winner.endpoint;
    return winner.api;
  } catch (error) {
    closeOthers(null);
    throw error;
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
}

async function connect(): Promise<ApiPromise> {
  if (api?.isConnected) return api;
  api = null;
  // Poll and manual retry can overlap; one race is enough.
  if (!connecting) {
    connecting = race().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

export async function fetchWud(): Promise<WudStats> {
  const client = await connect();

  const [assetOpt, meta] = await Promise.all([
    client.query.assets.asset(ASSET_ID),
    client.query.assets.metadata(ASSET_ID),
  ]).catch((error) => {
    // A node that accepted the socket and then stopped answering must not
    // poison every later poll — drop it so the next one races again.
    api = null;
    throw error;
  });

  if (!(assetOpt as unknown as { isSome: boolean }).isSome) {
    throw new Error(`asset ${ASSET_ID} not found on Asset Hub`);
  }

  const a = (assetOpt as unknown as { unwrap: () => Record<string, { toString: () => string }> }).unwrap();
  const m = meta as unknown as {
    name: { toUtf8: () => string };
    symbol: { toUtf8: () => string };
    decimals: { toNumber: () => number };
  };

  const decimals = m.decimals.toNumber();
  const supplyRaw = BigInt(a.supply.toString());
  const owner = a.owner.toString();
  const admin = a.admin.toString();
  const issuer = a.issuer.toString();
  const freezer = a.freezer.toString();

  return {
    name: m.name.toUtf8(),
    symbol: m.symbol.toUtf8(),
    decimals,
    supplyRaw,
    supply: Number(supplyRaw / 10n ** BigInt(decimals)),
    holders: Number(a.accounts.toString()),
    status: a.status.toString(),
    owner,
    admin,
    issuer,
    freezer,
    singleAuthority: new Set([owner, admin, issuer, freezer]).size === 1,
    endpoint: endpointUsed,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}
