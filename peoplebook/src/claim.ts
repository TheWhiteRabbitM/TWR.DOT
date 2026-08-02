/**
 * The on-chain claim + profile writes.
 *
 * Claiming mints a PeoplebookAvatars NFT to the caller on the devnet Asset Hub,
 * pays the contract's `price()` (1 PAS), and the contract rolls the rarity at
 * mint. Once you own a mask you can attach social links to it (Telegram, X, a
 * one-line bio) with setProfile — the contract only lets the token's owner do
 * it, so a profile is always vouched for by whoever holds the mask.
 *
 * Everything the SDK touches — the signer, the chain connection — comes from the
 * host, so nothing here opens its own wallet or its own socket.
 *
 * WHY THE VALUE IS PLANCK, NOT price()
 *   `price()` is in the contract's 18-decimal EVM units (1 PAS = 1e18). But the
 *   value passed to a pallet-revive call is native planck (10 decimals), which
 *   revive multiplies by 1e8 to get `msg.value`. So we send 1e10 planck; inside
 *   the contract that becomes 1e18, which clears the price.
 *
 * WHY THE RETRY
 *   The SDK auto-estimates gas with a dry-run, and that estimate is occasionally
 *   a hair short — the same call reverts `Revive.OutOfGas` once and lands on the
 *   next try. So a claim retries a couple of times before it gives up.
 */
import { keccak_256 } from '@noble/hashes/sha3';
import ABI from './abi.json';

const ADDRESS = '0xA56Fab4B4900FcccCd6ca8B064d8663eDfaa5bac';
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';
/** 0.1 PAS in native planck (10 decimals). msg.value inside the contract = ×1e8,
 *  so this clears a price of 1e17. Kept low so a modestly-funded devnet account
 *  can send it and still stay above its existential deposit — a 1 PAS value on a
 *  ~1 PAS balance fails with Revive.TransferFailed. */
const VALUE_PLANCK = 1_000_000_000n;
/** What a claim needs on top of the price: fee + storage deposit + the account's
 *  minimum balance. Deliberately generous — the point is a clear refusal instead
 *  of a `Revive.TransferFailed` after the wallet already asked for a signature. */
const MARGIN_PLANCK = 2_500_000_000n;
const ZERO_NODE = ('0x' + '00'.repeat(32)) as `0x${string}`;

const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const CLAIM_MS = 120_000;

export type ClaimStep = 'connecting' | 'preparing' | 'signing' | 'minting' | 'done';
export type ClaimResult =
  | { ok: true; tier: number }
  | { ok: false; why: string };

export type Socials = { telegram: string; x: string; bio: string };
export type ProfileResult = { ok: true } | { ok: false; why: string };

const toHex = (u: Uint8Array<ArrayBufferLike>) => '0x' + Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const utf8 = (s: string) => new TextEncoder().encode(s);
const keyOf = (handle: string) => toHex(keccak_256(utf8(handle))) as `0x${string}`;

/** ENS-style namehash, so the boost can prove ownership of a `.dot`. */
export function namehash(name: string): `0x${string}` {
  let node: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
  const clean = name.trim().toLowerCase().replace(/\.dot$/, '') + '.dot';
  for (const label of clean.split('.').reverse()) {
    if (!label) continue;
    const h = keccak_256(utf8(label));
    node = keccak_256(new Uint8Array([...node, ...h]));
  }
  return toHex(node) as `0x${string}`;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(v: any): string {
  if (v == null) return '';
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  } catch {
    return String(v);
  }
}

/** Turn a `.tx()` failure result into a reason worth showing.
 *
 *  The SDK answers with `err(Error)`, and `Error.prototype.message` is a
 *  NON-ENUMERABLE own property — so JSON.stringify()ing the error drops the one
 *  field that says what happened, leaving `{"isSdkError":true,"source":"tx"}`.
 *  Read the message first and fall back to the structured fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function revertReason(res: any): string {
  const e = res?.error ?? res;
  const bits = [
    e?.message,
    e?.name,
    e?.formatted ?? res?.formatted,
    typeof (e?.dispatchError ?? res?.dispatchError) === 'string'
      ? (e?.dispatchError ?? res?.dispatchError)
      : safeJson(e?.dispatchError ?? res?.dispatchError),
  ].filter(Boolean);
  const d = bits.join(' | ') || safeJson(res);

  if (/SigningRejected|rejected|cancel/i.test(d)) return 'You cancelled the signature.';
  if (/Timeout/i.test(d)) return 'Timed out waiting for the block — the claim may still land. Reopen in a moment before retrying.';
  if (/SignerMissing|no signer/i.test(d)) return 'No account connected — reopen peoplebook inside the Polkadot app.';
  if (/Inability to pay|Invalid Transaction/i.test(d)) return 'The signing account cannot pay the fee. Top it up with a little PAS and retry.';
  if (/PermissionDenied|permission/i.test(d)) return 'The Polkadot app refused the request — check peoplebook’s permissions.';
  if (/HandleTaken|taken/i.test(d)) return 'This mask has already been claimed.';
  if (/Underpaid/i.test(d)) return 'The payment did not clear the price.';
  if (/TransferFailed/i.test(d)) return 'Not enough PAS: your account can’t send the payment and stay above its minimum balance. Top up a little PAS and retry.';
  if (/StorageDeposit|Insufficient|Funds|Balance|Payment/i.test(d)) return 'Not enough PAS for the claim (price + a small storage deposit). Top up and retry.';
  if (/OutOfGas/i.test(d)) return 'Ran out of gas — try again.';
  if (/AccountUnmapped|unmapped/i.test(d)) return 'Your account still needs mapping — try once more.';
  return 'On-chain error: ' + (d || 'unknown').slice(0, 160);
}

/* ------------------------------------------------------------- the signer */

let slot: Promise<Slot | null> | null = null;
export type SignerKind = 'wallet' | 'app';
type Slot = {
  address: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any;
  /** 'wallet' = one of the user's own accounts; 'app' = the host-derived one. */
  kind: SignerKind;
  name?: string;
};

/**
 * Pick the account that will sign and PAY.
 *
 * The obvious call — `new SignerManager({ dappName })` — never touches the
 * user's wallet: the host derives an APP-SCOPED account for peoplebook.dot and
 * hands that back. Nobody ever funds that account, so a paid claim dies with
 * `Revive.TransferFailed` no matter how low the price goes, and the mask would
 * be minted to an address the person cannot see. So go through the accounts
 * provider directly and prefer the user's REAL accounts (`getLegacyAccounts`),
 * choosing the best-funded one; the app-scoped account is only a fallback for
 * hosts that expose no wallet accounts at all.
 */
async function connect(): Promise<Slot | null> {
  const [host, papi] = await Promise.all([
    import('@parity/product-sdk-host'),
    import('polkadot-api'),
  ]);
  if (!(await host.isInsideContainer().catch(() => false))) return null; // no host, no claim

  // The provider's methods answer with a ResultAsync (thenable, not a Promise),
  // so this boundary is deliberately untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: any = await withTimeout(host.getAccountsProvider() as any, CONNECT_MS, 'wallet').catch(() => null);
  if (!ap) return null;
  const ss58 = (pk: Uint8Array) => papi.AccountId().dec(pk) as string;

  // The user's own accounts first.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts: any[] = (r?.value ?? []).filter((a: { publicKey?: Uint8Array }) => a?.publicKey);
    if (accounts.length) {
      const best = await richest(accounts.map((a: any) => ({ ...a, address: ss58(a.publicKey) })));
      return { address: best.address, signer: ap.getLegacyAccountSigner({ publicKey: best.publicKey, name: best.name }), kind: 'wallet', name: best.name };
    }
  } catch { /* fall through to the app account */ }

  // Fallback: the app-scoped account. It works, but it starts empty, so the UI
  // has to say so rather than letting a claim fail with a cryptic revert.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getProductAccount('peoplebook.dot', 0)), ACCOUNT_MS, 'app account');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pa: any = r?.value;
    if (pa) {
      const address = pa.address ?? (pa.publicKey ? ss58(pa.publicKey) : null);
      if (address) return { address, signer: ap.getProductAccountSigner(pa), kind: 'app' };
    }
  } catch { /* no account at all */ }
  return null;
}

/** Of the user's accounts, the one that can actually pay. Balance reads are best
 *  effort — if they all fail we just take the first, which is the old behaviour. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function richest<T extends { address: string } & Record<string, any>>(accounts: T[]): Promise<T> {
  if (accounts.length === 1) return accounts[0];
  try {
    const [papi, descriptors, host] = await Promise.all([
      import('polkadot-api'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      import('@parity/product-sdk-host'),
    ]);
    const provider = await withTimeout(host.getHostProvider(GENESIS as `0x${string}`), CONNECT_MS, 'chain');
    if (!provider) return accounts[0];
    const api = papi.createClient(provider).getTypedApi(descriptors.devnet_asset_hub);
    const withBalance = await Promise.all(
      accounts.slice(0, 6).map(async (a) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const acc: any = await withTimeout(api.query.System.Account.getValue(a.address), 6_000, 'balance');
          return { a, free: BigInt(acc?.data?.free ?? 0) };
        } catch {
          return { a, free: 0n };
        }
      }),
    );
    withBalance.sort((x, y) => (y.free > x.free ? 1 : y.free < x.free ? -1 : 0));
    return withBalance[0].a;
  } catch {
    return accounts[0];
  }
}

/** Only a SUCCESSFUL connection is memoised. Caching a failure would make one
 *  bad boot permanent: every later retry would return the same dead session. */
function getSlot(): Promise<Slot | null> {
  if (!slot) {
    slot = connect().catch(() => null);
    void slot.then((s) => { if (!s) slot = null; });
  }
  return slot;
}

/** Which account is signing, for the UI: a real wallet account or the app's. */
export async function signerInfo(): Promise<{ address: string; kind: SignerKind; name?: string } | null> {
  const s = await getSlot().catch(() => null);
  return s ? { address: s.address, kind: s.kind, name: s.name } : null;
}

/** Start connecting early — the host handshake takes seconds it can spend while
 *  someone is still browsing. Fire and forget. */
export function warmUp(): void {
  void getSlot();
}

/** The connected account's address, or null when there is no host/wallet. */
export async function walletAddress(): Promise<string | null> {
  const s = await getSlot().catch(() => null);
  return s?.address ?? null;
}

/* ----------------------------------------------- a bound contract handle */

type Bound = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contract: any;
  slot: Slot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  descriptors: any;
};

/** Free balance of the connected account, in planck, or null if it can't be read.
 *  Used to refuse a claim we already know will revert: pallet-revive reports a
 *  short balance as `Revive.TransferFailed`, which tells the user nothing. */
async function freeBalance(b: Bound): Promise<bigint | null> {
  try {
    const api = b.client.getTypedApi(b.descriptors.devnet_asset_hub);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acc: any = await withTimeout(api.query.System.Account.getValue(b.slot.address), 8_000, 'balance');
    const free = acc?.data?.free;
    return typeof free === 'bigint' ? free : free != null ? BigInt(free) : null;
  } catch {
    return null; // never block a claim just because the read failed
  }
}

/** planck (10 decimals) → a short human string, e.g. "0.42 PAS". */
const asPas = (v: bigint) => (Number(v) / 1e10).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' PAS';

/** Connect the host chain, map the account once, and bind the contract. Shared
 *  by claim() and setProfile() so both take the exact same path. */
async function bind(): Promise<Bound | null> {
  const s = await getSlot().catch(() => null);
  if (!s) return null;

  const [contracts, descriptors, papi, host] = await Promise.all([
    import('@parity/product-sdk/contracts'),
    import('@parity/product-sdk-descriptors/devnet-asset-hub'),
    import('polkadot-api'),
    import('@parity/product-sdk-host'),
  ]);

  const provider = await withTimeout(host.getHostProvider(GENESIS as `0x${string}`), CONNECT_MS, 'chain');
  if (!provider) return null;
  const client = papi.createClient(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);

  // pallet-revive rejects an unmapped origin; a fresh account is unmapped. This
  // maps it the first time only.
  await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(runtime, s.address, s.signer),
    30_000,
    'account mapping',
  ).catch(() => undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract = (contracts as any).createContract(runtime, ADDRESS, ABI, { signer: s.signer });
  return { contract, slot: s, client, descriptors };
}

/* -------------------------------------------------------------- the claim */

export async function claim(
  handle: string,
  dotName: string | undefined,
  onStep: (s: ClaimStep) => void,
): Promise<ClaimResult> {
  onStep('connecting');
  const b = await bind().catch(() => null);
  if (!b) return { ok: false, why: 'No wallet — open peoplebook inside the Polkadot app to claim.' };
  const { contract } = b;

  // Refuse early if the account plainly cannot pay. Sending the value has to
  // leave enough behind for the fee, the storage deposit and the account's
  // minimum balance; when it doesn't, the chain answers `Revive.TransferFailed`,
  // which reads like a bug rather than "you need more PAS".
  const free = await freeBalance(b);
  if (free !== null && free < VALUE_PLANCK + MARGIN_PLANCK) {
    return {
      ok: false,
      why:
        `Not enough PAS. ${b.slot.kind === 'app' ? 'peoplebook’s app account' : 'Your account'} ` +
        `${b.slot.address} holds ${asPas(free)}; a claim needs about ${asPas(VALUE_PLANCK + MARGIN_PLANCK)} ` +
        `(0.1 to mint, the rest for the fee and storage deposit). ` +
        (b.slot.kind === 'app'
          ? 'This is an address the Polkadot app derived for peoplebook, not your wallet — send it a little PAS from your wallet, then try again.'
          : 'Top it up from the devnet faucet and try again.'),
    };
  }

  onStep('preparing');
  const node = dotName ? namehash(dotName) : ZERO_NODE;

  onStep('signing');
  // EXPLICIT LIMITS skip .tx()'s own dry-run so the wallet actually prompts (a
  // short estimate otherwise reverts OutOfGas before any signature). Unused
  // weight isn't charged; the storage deposit is reserved, not spent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any;
  try {
    res = await withTimeout(
      contract.claim.tx(handle, node, {
        value: VALUE_PLANCK,
        gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
        storageDepositLimit: 10n ** 18n,
      }),
      CLAIM_MS,
      'claim',
    );
  } catch (e) {
    const m = String((e as Error).message || e);
    if (/rejected|cancel/i.test(m)) return { ok: false, why: 'You cancelled the signature.' };
    return { ok: false, why: m.slice(0, 170) || 'The claim did not send.' };
  }

  onStep('minting');
  // `.tx()` reports a dispatch failure in its RESULT, not by throwing — surface
  // the real reason instead of a blank "tx not ok". A revert is deterministic,
  // so there is nothing to retry.
  if (res && res.ok === false) return { ok: false, why: revertReason(res) };

  // Read the rolled tier back for this handle.
  try {
    const id = (await contract.tokenOfHandle.query(keyOf(handle)))?.value;
    const tier = (await contract.tierOf.query(id))?.value;
    onStep('done');
    return { ok: true, tier: Number(tier) };
  } catch {
    onStep('done');
    return { ok: true, tier: 4 }; // minted; couldn't read the tier back — treat as common visually
  }
}

/* ------------------------------------------------------------- the profile */

/** Attach Telegram / X / bio to a mask you own. The contract enforces that only
 *  the token owner can write, so a non-owner gets a clean rejection. Editing is
 *  free — no mint price, just gas. Empty strings clear a field. */
export async function setProfile(
  handle: string,
  s: Socials,
  onStatus: (msg: string) => void,
): Promise<ProfileResult> {
  onStatus('Connecting your wallet…');
  const b = await bind().catch(() => null);
  if (!b) return { ok: false, why: 'No wallet — open peoplebook inside the Polkadot app.' };
  const { contract } = b;

  let id: bigint;
  try {
    const raw = (await contract.tokenOfHandle.query(keyOf(handle)))?.value;
    id = BigInt(raw ?? 0);
  } catch {
    return { ok: false, why: 'Could not read this mask on chain.' };
  }
  if (!id) return { ok: false, why: 'This mask has not been claimed yet.' };

  const tg = (s.telegram || '').replace(/^@/, '').slice(0, 32);
  const x = (s.x || '').replace(/^@/, '').slice(0, 32);
  const bio = (s.bio || '').slice(0, 160);

  onStatus('Approve the update in your wallet…');
  try {
    // Explicit limits skip the dry-run so the wallet actually prompts (same
    // reason as claim()); setProfile isn't payable, so no value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await withTimeout(
      contract.setProfile.tx(id, tg, x, bio, {
        gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
        storageDepositLimit: 10n ** 18n,
      }),
      CLAIM_MS,
      'setProfile',
    );
    if (res?.ok === false) {
      const raw = res.dispatchError ?? res.error ?? res.formatted ?? res;
      throw new Error(typeof raw === 'string' ? raw : JSON.stringify(raw, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    }
  } catch (e) {
    const m = String((e as Error).message || e);
    if (/rejected|cancel/i.test(m)) return { ok: false, why: 'You cancelled the signature.' };
    if (/NotOwner|not owner|owner/i.test(m)) return { ok: false, why: 'Only the mask owner can edit its links.' };
    if (/BadProfile|invalid/i.test(m)) return { ok: false, why: 'Those links have characters the chain won’t store.' };
    return { ok: false, why: m.slice(0, 120) || 'The update did not land.' };
  }
  onStatus('Saved on chain.');
  return { ok: true };
}
