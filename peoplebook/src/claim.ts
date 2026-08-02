/**
 * The on-chain claim + profile writes.
 *
 * Claiming mints a PeoplebookMasks NFT: one per account, generated from your
 * address and non-transferable, so there is no name to squat and no mask to buy.
 * A `.dot` label is the one identity provable on this chain, so it is handed to
 * the contract, checked against the registry, and only then recorded. Once you
 * hold a mask you can attach links (Telegram, X, a bio) with setProfile, which
 * the contract keys off your own mask — there is no id to pass and no way to
 * write someone else's.
 *
 * Everything the SDK touches — the signer, the chain connection — comes from the
 * host, so nothing here opens its own wallet or its own socket.
 */
import { keccak_256 } from '@noble/hashes/sha3';
import ABI from './abi.json';

const ADDRESS = '0x03a484cCD0f1832084dEEFca4bF6438d79Fe8db6';
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';

const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const CLAIM_MS = 120_000;

export type ClaimStep = 'connecting' | 'preparing' | 'signing' | 'minting' | 'done';
export type ClaimResult =
  | { ok: true; tier: number; id: number; verified: string }
  | { ok: false; why: string };

export type Socials = { telegram: string; x: string; bio: string };
export type ProfileResult = { ok: true } | { ok: false; why: string };

// The app no longer hashes a name itself: the contract recomputes the `.dot`
// namehash and checks it against the registry, which is the only place that
// check carries any weight.

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);
}

/**
 * The 20-byte address pallet-revive maps a Substrate account to.
 *
 * Contract mappings like `maskOf` are keyed by that H160, NOT by the ss58 string
 * the wallet reports — passing the ss58 straight through silently reads the
 * wrong slot, so an account that HAS a mask looks like it has none. revive uses
 * the Ethereum derivation: keccak256(public key), last 20 bytes. (Verified
 * against a known pair before relying on it.)
 */
async function h160Of(ss58: string): Promise<string> {
  const papi = await import('polkadot-api');
  const pk = papi.AccountId().enc(ss58);
  const h = keccak_256(pk).slice(12, 32);
  return '0x' + Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
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

/**
 * Claim THE mask for this account — one each, and it cannot be transferred.
 *
 * There is deliberately no handle argument any more. The first contract took any
 * handle string, which meant anyone could claim someone else's devnet identity
 * (and, through chirp, post as them); devnet handles live on the People chain,
 * which this contract cannot read, so there was no way to check. Removing the
 * name removes the thing worth squatting.
 *
 * A  label IS provable here: the contract recomputes its namehash and asks
 * the registry who owns it, records it only if that is you, and shifts the rarity
 * roll toward the rare end as a reward for a proven name.
 */
export async function claim(
  dotLabel: string | undefined,
  onStep: (s: ClaimStep) => void,
): Promise<ClaimResult> {
  onStep('connecting');
  const b = await bind().catch(() => null);
  if (!b) return { ok: false, why: 'No wallet — open peoplebook inside the Polkadot app to claim.' };
  const { contract } = b;

  onStep('preparing');
  const label = (dotLabel ?? '').trim().toLowerCase().replace(/[.]dot$/, '');

  onStep('signing');
  // Explicit limits skip .tx()'s own dry-run, which comes back short and would
  // revert OutOfGas before the wallet is ever asked to sign. Claiming is free,
  // so no value rides along.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any;
  try {
    res = await withTimeout(
      contract.claim.tx(label, {
        signer: b.slot.signer,
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
  if (res && res.ok === false) return { ok: false, why: revertReason(res) };

  try {
    const id = (await contract.maskOf.query(await h160Of(b.slot.address)))?.value;
    const tier = (await contract.tierOf.query(id))?.value;
    const verified = String((await contract.verifiedName.query(id))?.value ?? '');
    onStep('done');
    return { ok: true, tier: Number(tier), id: Number(id), verified };
  } catch {
    onStep('done');
    return { ok: true, tier: 4, id: 0, verified: '' };
  }
}

/** The mask this account holds, if any — so the page can open on your own mask. */
export async function myMask(): Promise<{ id: number; tier: number; verified: string; socials: Socials } | null> {
  const b = await bind().catch(() => null);
  if (!b) return null;
  try {
    const id = Number((await b.contract.maskOf.query(await h160Of(b.slot.address)))?.value ?? 0);
    if (!id) return null;
    const tier = Number((await b.contract.tierOf.query(BigInt(id)))?.value ?? 4);
    const verified = String((await b.contract.verifiedName.query(BigInt(id)))?.value ?? '');
    let socials: Socials = { telegram: '', x: '', bio: '' };
    try {
      const p = (await b.contract.profileOf.query(BigInt(id)))?.value;
      const g = (k: string, i: number) => String((Array.isArray(p) ? p[i] : (p as Record<string, unknown>)?.[k]) ?? '');
      socials = { telegram: g('telegram', 0), x: g('x', 1), bio: g('bio', 2) };
    } catch { /* no profile yet */ }
    return { id, tier, verified, socials };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the profile */

/** Attach Telegram / X / bio to YOUR mask. The contract keys the profile off the
 *  caller's own mask, so there is no id to pass and no way to write someone
 *  else's. Free — just gas. Empty strings clear a field. */
export async function setProfile(
  s: Socials,
  onStatus: (msg: string) => void,
): Promise<ProfileResult> {
  onStatus('Connecting your wallet…');
  const b = await bind().catch(() => null);
  if (!b) return { ok: false, why: 'No wallet — open peoplebook inside the Polkadot app.' };
  const { contract } = b;

  const tg = (s.telegram || '').replace(/^@/, '').slice(0, 32);
  const x = (s.x || '').replace(/^@/, '').slice(0, 32);
  const bio = (s.bio || '').slice(0, 160);

  onStatus('Approve the update in your wallet…');
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await withTimeout(
      contract.setProfile.tx(tg, x, bio, {
        signer: b.slot.signer,
        gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
        storageDepositLimit: 10n ** 18n,
      }),
      CLAIM_MS,
      'setProfile',
    );
    if (res?.ok === false) return { ok: false, why: revertReason(res) };
  } catch (e) {
    const m = String((e as Error).message || e);
    if (/rejected|cancel/i.test(m)) return { ok: false, why: 'You cancelled the signature.' };
    if (/NoMask/i.test(m)) return { ok: false, why: 'Claim your mask first.' };
    if (/BadProfile|invalid/i.test(m)) return { ok: false, why: 'Those links have characters the chain won’t store.' };
    return { ok: false, why: m.slice(0, 120) || 'The update did not land.' };
  }
  onStatus('Saved on chain.');
  return { ok: true };
}
