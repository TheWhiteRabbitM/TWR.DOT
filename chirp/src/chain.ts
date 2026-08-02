/**
 * Chirp's chain layer: read the feed, post, edit, like, follow.
 *
 * Everything lives in two contracts on the devnet Asset Hub — there is no server
 * and no Bulletin, so a chirp cannot expire or be taken down.
 *
 * IDENTITY. You post AS a mask, and PeoplebookMasks binds one mask to one
 * account and forbids transfer. So `Chirp.chirp()`'s `ownerOf(mask) == caller`
 * check means a post can only come from the account that mask belongs to: there
 * is no handle to squat and no mask to buy. That is the whole reason the masks
 * contract was rewritten.
 *
 * SIGNING. The host does not hand apps the user's wallet: `SignerManager({
 * dappName })` would sign with an app-scoped account the host derives, which
 * nobody funds. So we go through the accounts provider and prefer the user's own
 * accounts, falling back to the app-scoped one — and say which is in use.
 */
import MASKS_ABI from './masks-abi.json';
import CHIRP_ABI from './chirp-abi.json';

export const MASKS = '0x03a484cCD0f1832084dEEFca4bF6438d79Fe8db6';
export const CHIRP = '0x953143419c03d3786dce04d53e9ed199a16a82e0';
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';

const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const TX_MS = 120_000;
/** Generous, explicit limits. Without them the SDK dry-runs to size the call and
 *  that estimate comes back short, reverting OutOfGas before the wallet is even
 *  asked to sign. Unused weight is not charged. */
const LIMITS = {
  gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
  storageDepositLimit: 10n ** 18n,
};

export type Chirp = {
  id: number;
  mask: number;
  author: string;
  time: number;
  edited: number;
  replyTo: number;
  likes: number;
  body: string;
};
export type Me = {
  address: string;
  kind: 'wallet' | 'app';
  mask: number;      // 0 when this account has not claimed one
  name: string;      // verified .dot label, or ''
  tier: number;
};
export type Fail = { ok: false; why: string };
export type Ok<T> = { ok: true; value: T };

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);
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
  if (/NotYourMask/i.test(d)) return 'That mask is not yours.';
  if (/NotAuthor/i.test(d)) return 'Only the author can edit a chirp.';
  if (/AlreadyLiked/i.test(d)) return 'You already liked this.';
  if (/BadLength/i.test(d)) return 'A chirp is 1 to 280 characters.';
  if (/AlreadyClaimed/i.test(d)) return 'This account already has a mask.';
  if (/NoMask/i.test(d)) return 'Claim a mask first.';
  if (/Timeout/i.test(d)) return 'Timed out waiting for the block — it may still land.';
  if (/Inability to pay|TransferFailed|Funds|Balance/i.test(d)) return 'The signing account has no PAS for the fee.';
  return d.slice(0, 150) || 'The chain refused it.';
}

/* ------------------------------------------------------------------ session */

type Slot = {
  address: string;
  kind: 'wallet' | 'app';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  masks: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chirp: any;
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
  const ss58 = (pk: Uint8Array) => papi.AccountId().dec(pk) as string;

  let address = '';
  let kind: 'wallet' | 'app' = 'wallet';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signer: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (r?.value ?? []).find((x: any) => x?.publicKey);
    if (a) { address = ss58(a.publicKey); signer = ap.getLegacyAccountSigner({ publicKey: a.publicKey, name: a.name }); }
  } catch { /* fall through */ }
  if (!signer) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await withTimeout(Promise.resolve(ap.getProductAccount('chirp.dot', 0)), ACCOUNT_MS, 'app account');
      const pa = r?.value;
      if (pa) {
        address = pa.address ?? (pa.publicKey ? ss58(pa.publicKey) : '');
        signer = ap.getProductAccountSigner(pa);
        kind = 'app';
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
    (contracts as any).ensureContractAccountMapped(runtime, address, signer), 30_000, 'account mapping',
  ).catch(() => undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = (addr: string, abi: unknown) => (contracts as any).createContract(runtime, addr, abi, { signer });
  return { address, kind, signer, masks: mk(MASKS, MASKS_ABI), chirp: mk(CHIRP, CHIRP_ABI) };
}

function session(): Promise<Slot | null> {
  if (!slot) {
    slot = connect().catch(() => null);
    // Never memoise a failure: one bad boot would otherwise poison every retry.
    void slot.then((s) => { if (!s) slot = null; });
  }
  return slot;
}

export function warmUp(): void { void session(); }

/** Who is signing, and the mask they hold. Null outside the Polkadot app. */
export async function me(): Promise<Me | null> {
  const s = await session().catch(() => null);
  if (!s) return null;
  const q = async (c: unknown, m: string, ...a: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { return (await (c as any)[m].query(...a))?.value; } catch { return undefined; }
  };
  // maskOf is keyed by the H160 the runtime maps this account to, so ask the
  // contract rather than guessing the address form.
  let mask = 0;
  try { mask = Number((await q(s.masks, 'maskOf', s.address)) ?? 0); } catch { mask = 0; }
  let name = '', tier = 4;
  if (mask) {
    name = String((await q(s.masks, 'verifiedName', BigInt(mask))) ?? '');
    tier = Number((await q(s.masks, 'tierOf', BigInt(mask))) ?? 4);
  }
  return { address: s.address, kind: s.kind, mask, name, tier };
}

/* -------------------------------------------------------------------- reads */

/** A signer-less contract handle over the public RPC, so the timeline is
 *  readable by anyone — outside the Polkadot app, in a browser, from a preview.
 *  A social nobody can read without a wallet is not much of a social. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reader: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function publicChirp(): Promise<any> {
  if (!reader) {
    reader = (async () => {
      const [papi, ws, contracts, descriptors] = await Promise.all([
        import('polkadot-api'),
        import('polkadot-api/ws'),
        import('@parity/product-sdk/contracts'),
        import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      ]);
      const client = papi.createClient(ws.getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runtime = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (contracts as any).createContract(runtime, CHIRP, CHIRP_ABI);
    })().catch(() => null);
    void reader.then((r) => { if (!r) reader = null; });
  }
  return reader;
}

/** The newest `limit` chirps, newest first. Reads walk ids down from `count`;
 *  each chirp is two cheap queries, and there is no server to page through.
 *  Uses the host connection when there is one, the public RPC otherwise. */
export async function feed(limit = 40): Promise<Chirp[]> {
  const s = await session().catch(() => null);
  const c = s ? s.chirp : await publicChirp();
  if (!c) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = async (m: string, ...a: unknown[]) => { try { return (await (c as any)[m].query(...a))?.value; } catch { return undefined; } };
  const total = Number((await q('count')) ?? 0);
  const out: Chirp[] = [];
  for (let id = total; id > 0 && out.length < limit; id--) {
    const m = await q('meta', BigInt(id));
    if (!m) continue;
    const body = String((await q('body', BigInt(id))) ?? '');
    const g = (k: string, i: number) => (Array.isArray(m) ? m[i] : (m as Record<string, unknown>)[k]);
    out.push({
      id,
      mask: Number(g('mask', 0) ?? 0),
      author: String(g('author', 1) ?? ''),
      time: Number(g('time', 2) ?? 0),
      edited: Number(g('edited', 3) ?? 0),
      replyTo: Number(g('replyTo', 4) ?? 0),
      likes: Number(g('likes', 5) ?? 0),
      body,
    });
  }
  return out;
}

/* ------------------------------------------------------------------- writes */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send(fn: (s: Slot) => Promise<any>): Promise<Ok<void> | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'No wallet — open chirp inside the Polkadot app.' };
  try {
    const res = await withTimeout(fn(s), TX_MS, 'transaction');
    if (res && res.ok === false) return { ok: false, why: reason(res) };
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, why: reason({ error: e }) };
  }
}

/** Claim the mask for this account. One per account, and it cannot be moved —
 *  pass a `.dot` label you own to have the contract verify and record it. */
export function claimMask(dotLabel = ''): Promise<Ok<void> | Fail> {
  return send((s) => s.masks.claim.tx(dotLabel.trim().replace(/\.dot$/i, ''), { ...LIMITS, signer: s.signer }));
}

export function post(mask: number, body: string, replyTo = 0): Promise<Ok<void> | Fail> {
  return send((s) => s.chirp.chirp.tx(BigInt(mask), body, BigInt(replyTo), { ...LIMITS, signer: s.signer }));
}

export function edit(id: number, body: string): Promise<Ok<void> | Fail> {
  return send((s) => s.chirp.edit.tx(BigInt(id), body, { ...LIMITS, signer: s.signer }));
}

export function like(id: number): Promise<Ok<void> | Fail> {
  return send((s) => s.chirp.like.tx(BigInt(id), { ...LIMITS, signer: s.signer }));
}
