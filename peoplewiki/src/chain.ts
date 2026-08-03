/**
 * PeopleWiki's chain layer.
 *
 * The notes live in one contract on the devnet Asset Hub; the byline comes from
 * the same mask everything else in this ecosystem uses, so a note is written by
 * an account that cannot be squatted or transferred.
 *
 * Reading needs no wallet at all — a reference nobody can open without signing
 * in would be worth very little.
 */
import WIKI_ABI from './wiki-abi.json';
import MASKS_ABI from './masks-abi.json';
import HANDLES_ABI from './handles-abi.json';

export const WIKI = '0x0465Db2133a6A3B096Eb6e39E44daa31EF3E37AA';
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
export const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';
/** Every app in this ecosystem asks the host for the SAME product account, or
 *  the same person ends up as two. */
const IDENTITY_DAPP = 'peoplebook.dot';
const RPC = 'wss://asset-hub-paseo-rpc.n.dwellir.com';

const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const TX_MS = 120_000;
const LIMITS = {
  gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n },
  storageDepositLimit: 10n ** 18n,
};

export type Entry = {
  id: number;
  mask: number;
  author: string;
  time: number;
  edited: number;
  retracted: boolean;
  votes: number;
  tag: string;
  title: string;
  body: string;
  byline?: string;
  mine?: boolean;
  didVote?: boolean;
};
export type Me = { address: string; real: string | null; mask: number; byline: string };
export type Fail = { ok: false; why: string };
export type Ok = { ok: true };

const wait = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);

async function h160Of(ss58: string): Promise<string> {
  const [papi, { keccak_256 }] = await Promise.all([import('polkadot-api'), import('@noble/hashes/sha3')]);
  return '0x' + Array.from(keccak_256(papi.AccountId().enc(ss58)).slice(12, 32), (b) => b.toString(16).padStart(2, '0')).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reason(res: any): string {
  const e = res?.error ?? res;
  let d = '';
  try {
    d = [e?.message, e?.name, typeof e?.dispatchError === 'string' ? e.dispatchError : JSON.stringify(e?.dispatchError ?? '')]
      .filter(Boolean).join(' | ');
  } catch { d = String(e); }
  if (/SigningRejected|rejected|cancel/i.test(d)) return 'You cancelled the signature.';
  if (/Timeout/i.test(d)) return 'Timed out waiting for the block — it may still land.';
  if (/NotYourMask/i.test(d)) return 'That mask is not yours.';
  if (/ContractReverted/i.test(d))
    return 'The contract refused it — you may have voted already, or the note is not yours to change.';
  return d.slice(0, 150) || 'The chain refused it.';
}

/* ------------------------------------------------------------------ session */

type Slot = {
  address: string; h160: string; real: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any; manager?: any; api: any; wiki: any; masks: any; handles: any;
};
let slot: Promise<Slot | null> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function proxiedAccount(api: any, delegate: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await wait(api.query.Proxy.Proxies.getEntries(), 15_000, 'proxies');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = rows.filter((e: any) => (e?.value?.[0] ?? []).some((d: any) => String(d?.delegate) === delegate));
    return mine.length === 1 ? String(mine[0]?.keyArgs?.[0] ?? '') || null : null;
  } catch { return null; }
}

async function connect(): Promise<Slot | null> {
  const [host, papi, contracts, descriptors] = await Promise.all([
    import('@parity/product-sdk-host'), import('polkadot-api'),
    import('@parity/product-sdk/contracts'), import('@parity/product-sdk-descriptors/devnet-asset-hub'),
  ]);
  if (!(await host.isInsideContainer().catch(() => false))) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: any = await wait(host.getAccountsProvider() as any, CONNECT_MS, 'wallet').catch(() => null);
  if (!ap) return null;
  // Without this the host never raises a signing sheet and a write hangs.
  await wait(Promise.resolve(host.requestPermission({ tag: 'ChainSubmit', value: undefined })), CONNECT_MS, 'permission')
    .catch(() => undefined);

  let address = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signer: any = null; let manager: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await wait(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (r?.value ?? []).find((x: any) => x?.publicKey);
    if (a) { address = papi.AccountId().dec(a.publicKey) as string; signer = ap.getLegacyAccountSigner({ publicKey: a.publicKey, name: a.name }); }
  } catch { /* fall through */ }
  if (!signer) {
    // Not getProductAccountSigner: that signer never raises the wallet sheet.
    try {
      const sp = await import('@parity/product-sdk-signer');
      manager = new sp.SignerManager({ dappName: IDENTITY_DAPP });
      await wait(manager.connect(), CONNECT_MS, 'wallet').catch(() => undefined);
      const deadline = Date.now() + ACCOUNT_MS;
      for (;;) {
        const st = manager.getState();
        let acc = st.selectedAccount ?? null;
        if (!acc && st.accounts[0]) { const g = manager.selectAccount(st.accounts[0].address); if (g.ok) acc = g.value; }
        if (acc) { address = acc.address; signer = manager.getSigner(); break; }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { /* none */ }
  }
  if (!signer || !address) return null;

  const provider = await wait(host.getHostProvider(GENESIS as `0x${string}`), CONNECT_MS, 'chain');
  if (!provider) return null;
  const client = papi.createClient(provider);
  const api = client.getTypedApi(descriptors.devnet_asset_hub);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
  await wait(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(runtime, address, signer), 30_000, 'mapping',
  ).catch(() => undefined);

  const real = await proxiedAccount(api, address);
  const opts = manager ? { signerManager: manager, defaultOrigin: address } : { defaultSigner: signer, defaultOrigin: address };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = (a: string, abi: unknown) => (contracts as any).createContract(runtime, a, abi, opts);
  return {
    address, h160: await h160Of(real ?? address), real, signer, manager, api,
    wiki: mk(WIKI, WIKI_ABI), masks: mk(MASKS, MASKS_ABI), handles: mk(HANDLES, HANDLES_ABI),
  };
}

function session(): Promise<Slot | null> {
  if (!slot) { slot = connect().catch(() => null); void slot.then((s) => { if (!s) slot = null; }); }
  return slot;
}
export function warmUp(): void { void session(); }

/* -------------------------------------------------------------------- reads */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reader: Promise<any> | null = null;
function pub() {
  if (!reader) {
    reader = (async () => {
      const [papi, ws, contracts, descriptors] = await Promise.all([
        import('polkadot-api'), import('polkadot-api/ws'),
        import('@parity/product-sdk/contracts'), import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      ]);
      const client = papi.createClient(ws.getWsProvider(RPC));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rt = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mk = (a: string, abi: unknown) => (contracts as any).createContract(rt, a, abi);
      return { wiki: mk(WIKI, WIKI_ABI), masks: mk(MASKS, MASKS_ABI), handles: mk(HANDLES, HANDLES_ABI) };
    })().catch(() => null);
    void reader.then((r) => { if (!r) reader = null; });
  }
  return reader;
}

async function handles() {
  const s = await session().catch(() => null);
  return s
    ? { wiki: s.wiki, masks: s.masks, handles: s.handles, me: s.h160 }
    : { ...(await pub() ?? { wiki: null, masks: null, handles: null }), me: '' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = async (c: any, m: string, ...a: unknown[]) => { try { return (await c?.[m]?.query(...a))?.value; } catch { return undefined; } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pick = (v: any, k: string, i: number) => (Array.isArray(v) ? v[i] : v?.[k]);

/** The byline for a mask: the @handle it claimed, else its number. Cached — the
 *  same few authors repeat down a long page. */
const bylines = new Map<number, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bylineOf(masks: any, hc: any, mask: number): Promise<string> {
  const hit = bylines.get(mask);
  if (hit) return hit;
  const [h, p] = await Promise.all([
    hc ? q(hc, 'handleOf', BigInt(mask)) : Promise.resolve(undefined),
    q(masks, 'profileOf', BigInt(mask)),
  ]);
  const handle = String(h ?? '');
  const name = String(pick(p, 'displayName', 0) ?? '');
  const out = handle ? '@' + handle : name || 'mask #' + mask;
  bylines.set(mask, out);
  return out;
}
export function forgetBylines() { bylines.clear(); }

/** Every note, newest first. Reads go out in batches — one at a time made the
 *  page crawl as soon as there were more than a handful. */
export async function load(onBatch?: (soFar: Entry[]) => void): Promise<Entry[]> {
  const { wiki, masks, handles: hc, me } = await handles();
  if (!wiki) return [];
  const total = Number((await q(wiki, 'count')) ?? 0);
  const ids = Array.from({ length: total }, (_, i) => total - i);
  const out: Entry[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const got = await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      const [m, head, body, voted] = await Promise.all([
        q(wiki, 'meta', BigInt(id)),
        q(wiki, 'head', BigInt(id)),
        q(wiki, 'body', BigInt(id)),
        me ? q(wiki, 'voted', BigInt(id), me) : Promise.resolve(undefined),
      ]);
      if (!m) return null;
      const mask = Number(pick(m, 'mask', 0) ?? 0);
      const e: Entry = {
        id,
        mask,
        author: String(pick(m, 'author', 1) ?? ''),
        time: Number(pick(m, 'time', 2) ?? 0),
        edited: Number(pick(m, 'edited', 3) ?? 0),
        retracted: Boolean(pick(m, 'retracted', 4)),
        votes: Number(pick(m, 'up', 5) ?? 0),
        tag: String(pick(head, 'tag', 0) ?? ''),
        title: String(pick(head, 'title', 1) ?? ''),
        body: String(body ?? ''),
        didVote: Boolean(voted),
      };
      e.byline = await bylineOf(masks, hc, mask);
      e.mine = Boolean(me) && e.author.toLowerCase() === me.toLowerCase();
      return e;
    }));
    for (const e of got) if (e && !e.retracted) out.push(e);
    // Paint what has arrived. Twenty notes is three round trips; waiting for the
    // last one before showing the first is what made this look like it hung.
    onBatch?.(out.slice());
  }
  return out;
}

export async function me(): Promise<Me | null> {
  const s = await session().catch(() => null);
  if (!s) return null;
  const mask = Number((await q(s.masks, 'maskOf', s.h160)) ?? 0);
  return {
    address: s.address,
    real: s.real,
    mask,
    byline: mask ? await bylineOf(s.masks, s.handles, mask) : '',
  };
}

/* ------------------------------------------------------------------- writes */

async function send(method: string, args: unknown[]): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'No wallet — open PeopleWiki inside the Polkadot app.' };
  try {
    if (!s.real) {
      const o = { ...LIMITS, ...(s.manager ? { signerManager: s.manager } : { signer: s.signer }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await wait(s.wiki[method].tx(...args, o), TX_MS, 'transaction');
      if (res && res.ok === false) return { ok: false, why: reason(res) };
      return { ok: true };
    }
    // Signed by the app account but sent through the proxy, so the contract
    // records the person's real account as the author.
    const prepared = await wait(s.wiki[method].prepare(...args, { ...LIMITS, origin: s.real }), TX_MS, 'preparing');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner: any = (prepared as any)?.value ?? prepared;
    const call = inner?.decodedCall ?? inner?.call ?? inner;
    if (!call) return { ok: false, why: 'Could not build the call to send through your proxy.' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await wait(
      s.api.tx.Proxy.proxy({ real: { type: 'Id', value: s.real }, force_proxy_type: undefined, call }).signAndSubmit(s.signer),
      TX_MS, 'transaction',
    );
    if (res && res.ok === false) return { ok: false, why: reason(res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: reason({ error: e }) };
  }
}

export function addNote(mask: number, tag: string, title: string, body: string) {
  return send('add', [BigInt(mask), tag.trim().toLowerCase().slice(0, 24), title.trim().slice(0, 120), body.trim().slice(0, 4000)]);
}
export function editNote(id: number, tag: string, title: string, body: string) {
  return send('edit', [BigInt(id), tag.trim().toLowerCase().slice(0, 24), title.trim().slice(0, 120), body.trim().slice(0, 4000)]);
}
export function retractNote(id: number) { return send('retract', [BigInt(id)]); }
export function voteNote(id: number) { return send('vote', [BigInt(id)]); }
