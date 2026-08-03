/**
 * Chirp's chain layer: the timeline, and everything you can do to a post.
 *
 * Two contracts on the devnet Asset Hub, nothing else — no server, no Bulletin,
 * so a chirp cannot expire or be taken down by anyone but its author.
 *
 * IDENTITY. You post AS a mask. PeoplebookMasks2 binds one mask to one account
 * and refuses transfers, so `ownerOf(mask) == caller` means a post can only come
 * from the account that mask belongs to: nothing to squat, nothing to buy. The
 * display name is yours to choose (like the name on X); the tick is reserved for
 * a `.dot` the contract itself checked against the registry.
 *
 * ONE IDENTITY, ONE APP NAME. The host derives a different account per app name,
 * so every app in this ecosystem must ask for the SAME one or the same person
 * ends up as two. That string is IDENTITY_DAPP — changing it changes who you are.
 */
import { keccak_256 } from '@noble/hashes/sha3';
import MASKS_ABI from './masks-abi.json';
import CHIRP_ABI from './chirp-abi.json';
import HANDLES_ABI from './handles-abi.json';

export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
export const CHIRP = '0x37A7CE834428636815b2746408343574aD13be7C';
/** The @name registry. Separate from the masks contract because identity gained
 *  this field after masks and chirps already held content. */
export const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';
const IDENTITY_DAPP = 'peoplebook.dot';

const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const TX_MS = 120_000;
/** Explicit limits skip the SDK's sizing dry-run, whose estimate comes back short
 *  and reverts OutOfGas before the wallet is ever asked. Unused weight is free. */
const LIMITS = {
  gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
  storageDepositLimit: 10n ** 18n,
};

export type Post = {
  id: number;
  mask: number;
  author: string;
  time: number;
  edited: number;
  replyTo: number;
  quoteOf: number;
  deleted: boolean;
  likes: number;
  replies: number;
  reposts: number;
  body: string;
  /** Filled in for rendering: the identity behind `mask`. */
  who?: Who;
  /** The quoted post, when this is a quote or a repost. */
  quoted?: Post;
  liked?: boolean;
  reposted?: boolean;
};

export type Who = {
  mask: number;
  name: string;
  /** A .dot the CONTRACT checked against the registry — the only thing that
   *  earns a tick. */
  verified: string;
  /** The People chain username this mask goes by. Unique across masks and only
   *  settable by the holder, but NOT proof of anything: Asset Hub cannot read
   *  the People chain, so nobody can check it here. Shown without a tick. */
  handle: string;
  tier: number;
};
export type Me = Who & { address: string; kind: 'wallet' | 'app'; telegram: string; x: string; bio: string };
export type Fail = { ok: false; why: string };
export type Ok<T = void> = { ok: true; value: T };

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);
}

/** pallet-revive maps an account to keccak256(public key)'s last 20 bytes.
 *  Contract mappings are keyed by THAT, never by the ss58 the wallet reports. */
async function h160Of(ss58: string): Promise<string> {
  const papi = await import('polkadot-api');
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
  if (/Inability to pay|TransferFailed/i.test(d)) return 'The signing account cannot pay the fee.';
  // Custom Solidity errors are not decoded on this path — the chain says only
  // that the call reverted, so name what this app can actually hit.
  if (/ContractReverted/i.test(d)) return 'The contract refused it — the post may be deleted, or not yours to change.';
  return d.slice(0, 150) || 'The chain refused it.';
}

/* ------------------------------------------------------------------ session */

type Slot = {
  address: string;
  h160: string;
  kind: 'wallet' | 'app';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any; manager?: any; masks: any; chirp: any; handles: any;
};
let slot: Promise<Slot | null> | null = null;

async function connect(): Promise<Slot | null> {
  const [host, papi, contracts, descriptors] = await Promise.all([
    import('@parity/product-sdk-host'),
    import('polkadot-api'),
    import('@parity/product-sdk/contracts'),
    import('@parity/product-sdk-descriptors/devnet-asset-hub'),
  ]);
  if (!(await host.isInsideContainer().catch(() => false))) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: any = await withTimeout(host.getAccountsProvider() as any, CONNECT_MS, 'wallet').catch(() => null);
  if (!ap) return null;
  // Without this the host never raises a signing sheet and a write hangs silently.
  await withTimeout(Promise.resolve(host.requestPermission({ tag: 'ChainSubmit', value: undefined })), CONNECT_MS, 'permission')
    .catch(() => undefined);

  const ss58 = (pk: Uint8Array) => papi.AccountId().dec(pk) as string;
  let address = '';
  let kind: 'wallet' | 'app' = 'wallet';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: any = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (r?.value ?? []).find((x: any) => x?.publicKey);
    if (a) { address = ss58(a.publicKey); signer = ap.getLegacyAccountSigner({ publicKey: a.publicKey, name: a.name }); }
  } catch { /* fall through */ }

  // Fallback: SignerManager on the app-scoped account. NOT getProductAccountSigner —
  // that signer never raises the wallet sheet, so a write hangs until it times out.
  if (!signer) {
    try {
      const signerPkg = await import('@parity/product-sdk-signer');
      manager = new signerPkg.SignerManager({ dappName: IDENTITY_DAPP });
      await withTimeout(manager.connect(), CONNECT_MS, 'wallet').catch(() => undefined);
      const deadline = Date.now() + ACCOUNT_MS;
      for (;;) {
        const st = manager.getState();
        let acc = st.selectedAccount ?? null;
        if (!acc && st.accounts[0]) {
          const picked = manager.selectAccount(st.accounts[0].address);
          if (picked.ok) acc = picked.value;
        }
        if (acc) { address = acc.address; signer = manager.getSigner(); kind = 'app'; break; }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { /* none */ }
  }
  if (!signer || !address) return null;

  const provider = await withTimeout(host.getHostProvider(GENESIS as `0x${string}`), CONNECT_MS, 'chain');
  if (!provider) return null;
  const client = papi.createClient(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
  await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(runtime, address, signer), 30_000, 'mapping',
  ).catch(() => undefined);

  // `signer` is not a ContractOptions key — it is silently dropped. The real
  // names are signerManager / defaultSigner / defaultOrigin.
  const opts = manager ? { signerManager: manager, defaultOrigin: address } : { defaultSigner: signer, defaultOrigin: address };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = (addr: string, abi: unknown) => (contracts as any).createContract(runtime, addr, abi, opts);
  return {
    address, h160: await h160Of(address), kind, signer, manager,
    masks: mk(MASKS, MASKS_ABI), chirp: mk(CHIRP, CHIRP_ABI), handles: mk(HANDLES, HANDLES_ABI),
  };
}

function session(): Promise<Slot | null> {
  if (!slot) {
    slot = connect().catch(() => null);
    void slot.then((s) => { if (!s) slot = null; }); // never memoise a failure
  }
  return slot;
}
export function warmUp(): void { void session(); }

/* -------------------------------------------------------------------- reads */

/** A signer-less handle over the public RPC, so the timeline is readable without
 *  a wallet. A social nobody can read unless they sign in is not much of one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reader: Promise<{ chirp: any; masks: any } | null> | null = null;
function pub() {
  if (!reader) {
    reader = (async () => {
      const [papi, ws, contracts, descriptors] = await Promise.all([
        import('polkadot-api'), import('polkadot-api/ws'),
        import('@parity/product-sdk/contracts'),
        import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      ]);
      const client = papi.createClient(ws.getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rt = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mk = (a: string, abi: unknown) => (contracts as any).createContract(rt, a, abi);
      return { chirp: mk(CHIRP, CHIRP_ABI), masks: mk(MASKS, MASKS_ABI), handles: mk(HANDLES, HANDLES_ABI) };
    })().catch(() => null);
    void reader.then((r) => { if (!r) reader = null; });
  }
  return reader;
}

async function handles() {
  const s = await session().catch(() => null);
  return s
    ? { chirp: s.chirp, masks: s.masks, handles: s.handles, me: s.h160 }
    : { ...(await pub() ?? { chirp: null, masks: null, handles: null }), me: '' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = async (c: any, m: string, ...a: unknown[]) => { try { return (await c?.[m]?.query(...a))?.value; } catch { return undefined; } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pick = (v: any, key: string, i: number) => (Array.isArray(v) ? v[i] : v?.[key]);

/** The identity behind a mask, cached — a timeline hits the same few masks over
 *  and over and each lookup is two chain reads. */
const whoCache = new Map<number, Who>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function whoOf(masks: any, mask: number, handlesC?: any): Promise<Who> {
  const hit = whoCache.get(mask);
  if (hit) return hit;
  const hc = handlesC ?? (await handles()).handles;
  const [v, t, p, h] = await Promise.all([
    q(masks, 'verifiedName', BigInt(mask)),
    q(masks, 'tierOf', BigInt(mask)),
    q(masks, 'profileOf', BigInt(mask)),
    hc ? q(hc, 'handleOf', BigInt(mask)) : Promise.resolve(undefined),
  ]);
  const verified = String(v ?? '');
  const tier = Number(t ?? 4);
  const name = String(pick(p, 'displayName', 0) ?? '');
  const who: Who = { mask, name, verified, handle: String(h ?? ''), tier };
  whoCache.set(mask, who);
  return who;
}
export function forgetWho(mask?: number) { if (mask) whoCache.delete(mask); else whoCache.clear(); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readPost(chirp: any, masks: any, me: string, id: number, depth = 1): Promise<Post | null> {
  // meta, body and the two "did I" flags do not depend on each other, so they go
  // out together: a post used to cost four sequential round-trips.
  const [m, bodyText, likedFlag, repostFlag] = await Promise.all([
    q(chirp, 'meta', BigInt(id)),
    q(chirp, 'body', BigInt(id)),
    me ? q(chirp, 'liked', BigInt(id), me) : Promise.resolve(undefined),
    me ? q(chirp, 'repostOf', BigInt(id), me) : Promise.resolve(undefined),
  ]);
  if (!m) return null;
  const post: Post = {
    id,
    mask: Number(pick(m, 'mask', 0) ?? 0),
    author: String(pick(m, 'author', 1) ?? ''),
    time: Number(pick(m, 'time', 2) ?? 0),
    edited: Number(pick(m, 'edited', 3) ?? 0),
    replyTo: Number(pick(m, 'replyTo', 4) ?? 0),
    quoteOf: Number(pick(m, 'quoteOf', 5) ?? 0),
    deleted: Boolean(pick(m, 'deleted', 6)),
    likes: Number(pick(m, 'likes', 7) ?? 0),
    replies: Number(pick(m, 'replies', 8) ?? 0),
    reposts: Number(pick(m, 'reposts', 9) ?? 0),
    body: String(bodyText ?? ''),
  };
  post.who = await whoOf(masks, post.mask);
  if (me) {
    post.liked = Boolean(likedFlag);
    post.reposted = Number(repostFlag ?? 0) > 0;
  }
  if (post.quoteOf && depth > 0) post.quoted = (await readPost(chirp, masks, me, post.quoteOf, depth - 1)) ?? undefined;
  return post;
}

/**
 * Every post, newest first, read once and reused.
 *
 * The profile, search, the Following tab and notifications are all slices of the
 * same list, so it is fetched once per refresh instead of once per view. At this
 * size that is cheaper than being clever, and it keeps every view consistent
 * with the others.
 */
export async function loadAll(limit = 300): Promise<Post[]> {
  const { chirp, masks, me } = await handles();
  if (!chirp) return [];
  const total = Number((await q(chirp, 'count')) ?? 0);
  const ids: number[] = [];
  for (let id = total; id > 0 && ids.length < limit; id--) ids.push(id);
  // Batched rather than one-at-a-time: sequential reads made the feed crawl as
  // soon as there were more than a handful of posts. Ten at a time keeps the
  // node from being hammered while staying an order of magnitude faster.
  const out: Post[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map((id) => readPost(chirp, masks, me, id)));
    for (const p of batch) if (p && !p.deleted) out.push(p);
  }
  return out;
}

/** Everyone who holds a mask — the people you can search and follow. */
export async function people(): Promise<Who[]> {
  const { masks } = await handles();
  if (!masks) return [];
  const total = Number((await q(masks, 'totalSupply')) ?? 0);
  const ids = Array.from({ length: total }, (_, i) => i + 1);
  const out: Who[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    out.push(...(await Promise.all(ids.slice(i, i + 10).map((n) => whoOf(masks, n)))));
  }
  return out;
}

/** The masks you follow. The contract keys follows by (you, mask), so this asks
 *  about each mask rather than reading a list that does not exist on chain. */
export async function following(): Promise<Set<number>> {
  const s = await session().catch(() => null);
  if (!s) return new Set();
  const total = Number((await q(s.masks, 'totalSupply')) ?? 0);
  const flags = await Promise.all(
    Array.from({ length: total }, (_, i) => q(s.chirp, 'follows', s.h160, BigInt(i + 1))),
  );
  const set = new Set<number>();
  flags.forEach((on, i) => { if (on) set.add(i + 1); });
  return set;
}

/**
 * Who follows a mask, and who it follows.
 *
 * The contract keys follows by (account, mask), so there is no list to read —
 * but every account that can follow is the owner of a mask, and the mask supply
 * is enumerable. So the set of candidates IS knowable: walk the masks, ask who
 * owns each, and ask the contract about that pair. It is a scan, but a bounded
 * one, and it beats showing a number nobody can open.
 */
export async function connections(mask: number): Promise<{ followers: Who[]; followingList: Who[] }> {
  const { masks, chirp } = await handles();
  if (!masks || !chirp) return { followers: [], followingList: [] };
  const total = Number((await q(masks, 'totalSupply')) ?? 0);
  const ids = Array.from({ length: total }, (_, i) => i + 1);

  const owners = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 10) {
    const slice = ids.slice(i, i + 10);
    const got = await Promise.all(slice.map((n) => q(masks, 'ownerOf', BigInt(n))));
    slice.forEach((n, k) => { const o = got[k]; if (o) owners.set(n, String(o)); });
  }

  const [followsMe, iFollow] = await Promise.all([
    Promise.all(ids.map((n) => (owners.has(n) ? q(chirp, 'follows', owners.get(n), BigInt(mask)) : undefined))),
    Promise.all(ids.map((n) => (owners.has(mask) ? q(chirp, 'follows', owners.get(mask), BigInt(n)) : undefined))),
  ]);

  const pickWho = async (flags: unknown[]) => {
    const wanted = ids.filter((_, i) => Boolean(flags[i]));
    const out: Who[] = [];
    for (let i = 0; i < wanted.length; i += 10) {
      out.push(...(await Promise.all(wanted.slice(i, i + 10).map((n) => whoOf(masks, n)))));
    }
    return out;
  };
  return { followers: await pickWho(followsMe), followingList: await pickWho(iFollow) };
}

/** A profile: who they are, what they wrote, and how they connect. */
export async function profile(mask: number): Promise<{
  who: Who; bio: string; telegram: string; x: string;
  followers: number; posts: Post[]; isMe: boolean; iFollow: boolean;
}> {
  const { masks } = await handles();
  const s = await session().catch(() => null);
  const who = masks ? await whoOf(masks, mask) : { mask, name: '', verified: '', handle: '', tier: 4 };
  const p = masks ? await q(masks, 'profileOf', BigInt(mask)) : undefined;
  const all = await loadAll();
  const followers = Number((await q((await handles()).chirp, 'followerCount', BigInt(mask))) ?? 0);
  const myMask = s ? Number((await q(s.masks, 'maskOf', s.h160)) ?? 0) : 0;
  return {
    who,
    bio: String(pick(p, 'bio', 3) ?? ''),
    telegram: String(pick(p, 'telegram', 1) ?? ''),
    x: String(pick(p, 'x', 2) ?? ''),
    followers,
    posts: all.filter((z) => z.mask === mask),
    isMe: myMask === mask,
    iFollow: s ? Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask))) : false,
  };
}

/** What happened to you: replies and quotes of your posts, newest first. There
 *  is no notification store on chain, so this is derived from the feed. */
export async function notifications(myMask: number): Promise<Post[]> {
  if (!myMask) return [];
  const all = await loadAll();
  const mine = new Set(all.filter((p) => p.mask === myMask).map((p) => p.id));
  return all.filter((p) => p.mask !== myMask && ((p.replyTo && mine.has(p.replyTo)) || (p.quoteOf && mine.has(p.quoteOf))));
}

/** The timeline, newest first. Replies are left out of the main feed — they
 *  belong to their thread, exactly as they do on X. */
export async function feed(limit = 30): Promise<Post[]> {
  const { chirp, masks, me } = await handles();
  if (!chirp) return [];
  const total = Number((await q(chirp, 'count')) ?? 0);
  const out: Post[] = [];
  for (let id = total; id > 0 && out.length < limit; id--) {
    const p = await readPost(chirp, masks, me, id);
    if (!p || p.deleted || p.replyTo) continue;
    out.push(p);
  }
  return out;
}

/** A post with its parent chain and its direct replies — the thread view. */
export async function thread(id: number): Promise<{ parents: Post[]; post: Post | null; replies: Post[] }> {
  const { chirp, masks, me } = await handles();
  if (!chirp) return { parents: [], post: null, replies: [] };
  const post = await readPost(chirp, masks, me, id);
  const parents: Post[] = [];
  let up = post?.replyTo ?? 0;
  while (up && parents.length < 6) {
    const p = await readPost(chirp, masks, me, up);
    if (!p) break;
    parents.unshift(p);
    up = p.replyTo;
  }
  // The replies come out of the one feed read the app already does, instead of
  // walking every chirp again for each thread opened.
  const all = await loadAll();
  const replies = all.filter((p) => p.replyTo === id);
  return { parents, post, replies };
}

/** Who you are, and the profile you can edit. Null outside the Polkadot app. */
export async function me(): Promise<Me | null> {
  const s = await session().catch(() => null);
  if (!s) return null;
  const mask = Number((await q(s.masks, 'maskOf', s.h160)) ?? 0);
  if (!mask) return { address: s.address, kind: s.kind, mask: 0, name: '', verified: '', handle: '', tier: 4, telegram: '', x: '', bio: '' };
  const who = await whoOf(s.masks, mask);
  const p = await q(s.masks, 'profileOf', BigInt(mask));
  return {
    ...who,
    address: s.address,
    kind: s.kind,
    telegram: String(pick(p, 'telegram', 1) ?? ''),
    x: String(pick(p, 'x', 2) ?? ''),
    bio: String(pick(p, 'bio', 3) ?? ''),
  };
}

/** The username the host says you have on the People chain, to offer as a
 *  default display name. Host-attested, not provable on chain — so it is only
 *  ever a suggestion, never a tick. */
export async function suggestedName(): Promise<string> {
  try {
    const host = await import('@parity/product-sdk-host');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ap: any = await (host.getAccountsProvider() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getUserId()), ACCOUNT_MS, 'user id');
    return String(r?.value?.primaryUsername ?? '');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------- writes */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send(fn: (s: Slot, o: any) => Promise<any>): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'No wallet — open chirp inside the Polkadot app.' };
  const o = { ...LIMITS, ...(s.manager ? { signerManager: s.manager } : { signer: s.signer }) };
  try {
    const res = await withTimeout(fn(s, o), TX_MS, 'transaction');
    if (res && res.ok === false) return { ok: false, why: reason(res) };
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, why: reason({ error: e }) };
  }
}

export function claimMask(dotLabel = ''): Promise<Ok | Fail> {
  return send((s, o) => s.masks.claim.tx(dotLabel.trim().replace(/\.dot$/i, ''), o));
}

/** Your public details. The name is free text you choose — the tick belongs to a
 *  `.dot`, which the contract verifies, and to nothing else. */
export function saveProfile(name: string, telegram: string, x: string, bio: string): Promise<Ok | Fail> {
  return send((s, o) => s.masks.setProfile.tx(
    name.slice(0, 40), telegram.replace(/^@/, '').slice(0, 32), x.replace(/^@/, '').slice(0, 32), bio.slice(0, 160), o,
  ));
}

/** Attach the People chain username this mask goes by. First come first served
 *  across masks; the app offers only what the host says is yours, but the chain
 *  cannot check that, so it is never shown with a tick. */
export function setHandle(mask: number, handle: string): Promise<Ok | Fail> {
  return send((s, o) => s.handles.setHandle.tx(BigInt(mask), handle.trim().replace(/^@/, ''), o));
}

export function post(mask: number, body: string, replyTo = 0, quoteOf = 0): Promise<Ok | Fail> {
  return send((s, o) => s.chirp.chirp.tx(BigInt(mask), body, BigInt(replyTo), BigInt(quoteOf), o));
}

export function edit(id: number, body: string): Promise<Ok | Fail> {
  return send((s, o) => s.chirp.edit.tx(BigInt(id), body, o));
}

export function remove(id: number): Promise<Ok | Fail> {
  return send((s, o) => s.chirp.remove.tx(BigInt(id), o));
}

/** A heart is a toggle: ask the chain what you already did rather than guessing,
 *  because liking twice reverts. */
export async function toggleLike(id: number): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'No wallet — open chirp inside the Polkadot app.' };
  const already = Boolean(await q(s.chirp, 'liked', BigInt(id), s.h160));
  return send((x, o) => (already ? x.chirp.unlike.tx(BigInt(id), o) : x.chirp.like.tx(BigInt(id), o)));
}

/** Reposting again retracts the repost you made — the contract remembers which
 *  chirp was yours, so this undoes rather than piling copies up. */
export async function toggleRepost(id: number, mask: number): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'No wallet — open chirp inside the Polkadot app.' };
  const mine = Number((await q(s.chirp, 'repostOf', BigInt(id), s.h160)) ?? 0);
  return mine
    ? send((x, o) => x.chirp.remove.tx(BigInt(mine), o))
    : send((x, o) => x.chirp.chirp.tx(BigInt(mask), '', 0n, BigInt(id), o));
}

export async function toggleFollow(mask: number): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'No wallet — open chirp inside the Polkadot app.' };
  const on = Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask)));
  return send((x, o) => x.chirp.follow.tx(BigInt(mask), !on, o));
}

export async function isFollowing(mask: number): Promise<boolean> {
  const s = await session().catch(() => null);
  if (!s) return false;
  return Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask)));
}
