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
/** 1 PAS in native planck (10 decimals). msg.value inside the contract = ×1e8. */
const VALUE_PLANCK = 10_000_000_000n;
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

/* ------------------------------------------------------------- the signer */

let slot: Promise<Slot | null> | null = null;
type Slot = {
  manager: import('@parity/product-sdk-signer').SignerManager;
  account: import('@parity/product-sdk-signer').SignerAccount;
};

async function connect(): Promise<Slot | null> {
  const [host, signerPkg] = await Promise.all([
    import('@parity/product-sdk-host'),
    import('@parity/product-sdk-signer'),
  ]);
  if (!(await host.isInsideContainer().catch(() => false))) return null; // no host, no claim

  const manager = new signerPkg.SignerManager({ dappName: 'peoplebook.dot' });
  await withTimeout(manager.connect(), CONNECT_MS, 'wallet').catch(() => undefined);
  const deadline = Date.now() + ACCOUNT_MS;
  let account: import('@parity/product-sdk-signer').SignerAccount | null = null;
  for (;;) {
    const s = manager.getState();
    if (s.selectedAccount) { account = s.selectedAccount; break; }
    const first = s.accounts[0];
    if (first) { const p = manager.selectAccount(first.address); if (p.ok) { account = p.value; break; } }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return account ? { manager, account } : null;
}

function getSlot(): Promise<Slot | null> {
  if (!slot) slot = connect().catch(() => null);
  return slot;
}

/** Start connecting early — the host handshake takes seconds it can spend while
 *  someone is still browsing. Fire and forget. */
export function warmUp(): void {
  void getSlot();
}

/** The connected account's address, or null when there is no host/wallet. */
export async function walletAddress(): Promise<string | null> {
  const s = await getSlot().catch(() => null);
  return s?.account.address ?? null;
}

/* ----------------------------------------------- a bound contract handle */

type Bound = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contract: any;
  slot: Slot;
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
  const signer = s.manager.getSigner();
  if (!signer) return null;

  // pallet-revive rejects an unmapped origin; a fresh account is unmapped. This
  // maps it the first time only.
  await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(runtime, s.account.address, signer),
    30_000,
    'account mapping',
  ).catch(() => undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract = (contracts as any).createContract(runtime, ADDRESS, ABI, { signerManager: s.manager });
  return { contract, slot: s };
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

  onStep('preparing');
  const node = dotName ? namehash(dotName) : ZERO_NODE;

  onStep('signing');
  let landed = false;
  let lastErr = '';
  for (let attempt = 0; attempt < 3 && !landed; attempt++) {
    try {
      // EXPLICIT LIMITS — the whole reason a claim would never prompt the wallet.
      // `.tx()` normally sizes the call with its own dry-run; for this contract
      // that estimate comes back short, so the tx reverts `Revive.OutOfGas`
      // WITHOUT ever asking for a signature ("tx not ok" with no wallet popup).
      // Passing both limits skips the dry-run and submits generously — unused
      // weight is not charged and the storage deposit is reserved, not spent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await withTimeout(
        contract.claim.tx(handle, node, {
          value: VALUE_PLANCK,
          gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
          storageDepositLimit: 10n ** 18n,
        }),
        CLAIM_MS,
        'claim',
      );
      if (res?.ok === false) throw new Error(res?.dispatchError ? String(res.formatted ?? 'dispatch failed') : 'tx not ok');
      landed = true;
      if (attempt === 0) onStep('minting');
    } catch (e) {
      lastErr = String((e as Error).message || e);
      if (/rejected|cancel/i.test(lastErr)) return { ok: false, why: 'You cancelled the signature.' };
      if (/Funds|Insufficient|Payment|Balance/i.test(lastErr)) return { ok: false, why: 'Not enough PAS to claim.' };
      if (/HandleTaken|taken/i.test(lastErr)) return { ok: false, why: 'This mask was just claimed by someone else.' };
      // OutOfGas / estimation flake — wait a beat and retry.
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!landed) return { ok: false, why: lastErr.slice(0, 120) || 'The claim did not land.' };

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
    if (res?.ok === false) throw new Error(res?.dispatchError ? String(res.formatted ?? 'dispatch failed') : 'tx not ok');
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
