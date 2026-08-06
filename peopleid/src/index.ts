/**
 * peopleid — one identity for the whole suite.
 *
 * NAMED AFTER peoplebook, DELIBERATELY
 *   It was called `dotid` for an afternoon, which was careless: DotID is
 *   somebody else's project and we have nothing to do with them. This is named
 *   after the app that actually owns the identity here, which is also the app
 *   name the host derives every account from. The name and the thing agree.
 *
 * WHY THIS IS A PACKAGE AND NOT A PATTERN
 *   Every app in this workspace had its own copy of "who is this person". The
 *   copies drifted, and the drift was silent: dotmail asked the host for an
 *   account under its OWN name, got a different account from the one chirp uses,
 *   and became a different human being. Nothing errored. The mask simply was not
 *   there, no key could be published against it, and no letter could ever be
 *   addressed to it.
 *
 *   The rule that prevents it is one line long and impossible to remember at the
 *   right moment, so it lives here instead of in a comment in each app:
 *
 *     THE HOST DERIVES A DIFFERENT ACCOUNT PER APP NAME.
 *     ASK FOR THE SUITE'S NAME, NOT YOUR OWN.
 *
 * WHAT AN IDENTITY IS HERE
 *   An account, derived by the host from IDENTITY_DAPP.
 *   A mask, which peoplebook holds and which cannot be transferred.
 *   A handle, unique across all masks, which names you to everybody else.
 *
 *   The mask is the anchor. Anything an app wants to attach to a person —
 *   a mailbox key, a profile, a reputation — hangs off the mask, and is written
 *   by whoever the mask says it belongs to.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 *   That the handle belongs to the People-chain user of the same spelling. Asset
 *   Hub cannot read that chain, so nothing here can check it, and no caller
 *   should draw a tick from what this returns.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * THE NAME. Changing this string changes who everybody is.
 *
 * It is the suite's name, not any one app's. peoplebook holds the identities,
 * so peoplebook names them, and chirp, dotmail and everything after must ask
 * for the same thing or become strangers to each other.
 */
export const IDENTITY_DAPP = 'peoplebook.dot';

/** Devnet Asset Hub, where all of this lives. */
export const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' as const;

/** peoplebook's masks: one mask, one account, transfers refused. */
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
/** Handles: one name, one mask, first come. */
export const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';

const MASKS_ABI = [
  { inputs: [{ name: 'id', type: 'uint256' }], name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  // The reverse index, which the contract has had all along. Walking every mask
  // comparing owners was sixty reads to answer what this answers in one.
  { inputs: [{ name: 'who', type: 'address' }], name: 'maskOf',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'uint256' }], name: 'tierOf',
    outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'uint256' }], name: 'profileOf',
    outputs: [{ name: '', type: 'string' }, { name: '', type: 'string' },
      { name: '', type: 'string' }, { name: '', type: 'string' }],
    stateMutability: 'view', type: 'function' },
];
const HANDLES_ABI = [
  { inputs: [{ name: 'h', type: 'bytes32' }], name: 'maskOfHandle',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'mask', type: 'uint256' }], name: 'handleOf',
    outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
];

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/* --------------------------------------------------------------- answers
 *
 * Three states everywhere, not two. `null` means the chain was not asked or
 * refused; `undefined` means it answered and there is nothing. Collapsing those
 * into one is the single most repeated bug in this codebase: it turns a network
 * hiccup into "this person does not exist".
 */
export type Answer<T> = T | null | undefined;

/**
 * A read that cannot hang forever. "I pressed it and nothing happened" is what
 * an unresolved promise looks like from a chair.
 */
export function withTimeout<T>(p: Promise<T>, ms = 15_000): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

/* ------------------------------------------------------------ connection */

export type Session = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt: any; sdk: any; host: any; api: any;
  /** The account this app acts as, which is the SUITE's account. */
  address: string | null;
  /** Bind on a contract as `signerManager`. Not `signer`, which is not a
   *  ContractOptions key and is dropped in silence. Not
   *  `getProductAccountSigner`, which never raises the wallet sheet, so a write
   *  signed with it hangs rather than asking anybody anything. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manager: any;
};

let pending: Promise<Session | null> | null = null;

async function connect(): Promise<Session | null> {
  try {
    const host = await import('@parity/product-sdk-host');
    const { createClient } = await import('polkadot-api');
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const sdk = await import('@parity/product-sdk/contracts');

    const provider = await host.getHostProvider(GENESIS);
    if (!provider) return null;

    const client = createClient(provider as never);
    const rt = sdk.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
    const api = client.getTypedApi(descriptors.devnet_asset_hub);

    let address: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manager: any = null;
    try {
      const signerPkg = await import('@parity/product-sdk-signer');
      manager = new signerPkg.SignerManager({ dappName: IDENTITY_DAPP });
      await manager.connect().catch(() => undefined);
      const deadline = Date.now() + 12_000;
      for (;;) {
        const st = manager.getState();
        let acc = st.selectedAccount ?? null;
        if (!acc && st.accounts[0]) {
          const picked = manager.selectAccount(st.accounts[0].address);
          if (picked.ok) acc = picked.value;
        }
        if (acc) { address = acc.address; break; }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { manager = null; }

    return { rt, sdk, host, api, address, manager };
  } catch {
    return null;
  }
}

/**
 * The one connection, shared.
 *
 * Cached as a PROMISE so two callers racing at startup share one attempt. A
 * host provider is not a pool: opening it twice gives one connection that works
 * and one that hangs forever, which is a failure with no error message.
 */
export function session(): Promise<Session | null> {
  if (!pending) pending = connect();
  return pending;
}

/** Forget it, so the next caller reconnects. */
export function forgetSession() { pending = null; }

/* -------------------------------------------------------------- identity */

export type Identity = {
  /** SS58, as the host names it. */
  address: string;
  /** The same account as pallet-revive addresses it, for contract comparisons. */
  h160: string;
  mask: number | null;
  handle: string;
};

/**
 * An account as pallet-revive addresses it.
 *
 * AccountId32Mapper branches: an account already derived from an eth address is
 * `[addr20, 0xEE * 12]` and keeps those twenty bytes; anything else is keccak'd
 * and the last twenty taken. Truncating unconditionally produces a plausible
 * address that is simply somebody else's.
 */
export function h160Of(publicKey: Uint8Array): string {
  let ethDerived = publicKey.length === 32;
  if (ethDerived) for (let i = 20; i < 32; i++) if (publicKey[i] !== 0xee) { ethDerived = false; break; }
  return ethDerived ? toHex(publicKey.slice(0, 20)) : toHex(keccak_256(publicKey).slice(12, 32));
}

/** The mask a handle names, in one read. `undefined` means nobody holds it. */
export async function maskOfHandle(handle: string): Promise<Answer<number>> {
  const s = await withTimeout(session());
  if (s === 'timeout' || !s) return null;
  try {
    const c = s.sdk.createContract(s.rt, HANDLES, HANDLES_ABI, {});
    const hash = toHex(keccak_256(enc.encode(handle.trim().toLowerCase())));
    const r = await withTimeout<{ value?: unknown }>(c.maskOfHandle.query(hash));
    if (r === 'timeout' || r?.value === undefined) return null;
    const mask = Number(r.value as bigint);
    return mask > 0 ? mask : undefined;
  } catch { return null; }
}

/** The handle a mask goes by, if it has claimed one. */
export async function handleOfMask(mask: number): Promise<Answer<string>> {
  const s = await withTimeout(session());
  if (s === 'timeout' || !s) return null;
  try {
    const c = s.sdk.createContract(s.rt, HANDLES, HANDLES_ABI, {});
    const r = await withTimeout<{ value?: unknown }>(c.handleOf.query(BigInt(mask)));
    if (r === 'timeout' || r?.value === undefined) return null;
    const h = String(r.value ?? '').trim();
    return h || undefined;
  } catch { return null; }
}

/** Who owns a mask. */
export async function ownerOfMask(mask: number): Promise<Answer<string>> {
  const s = await withTimeout(session());
  if (s === 'timeout' || !s) return null;
  try {
    const c = s.sdk.createContract(s.rt, MASKS, MASKS_ABI, {});
    const r = await withTimeout<{ value?: unknown }>(c.ownerOf.query(BigInt(mask)));
    if (r === 'timeout' || r?.value === undefined) return null;
    const a = String((r.value as { asHex?: () => string })?.asHex?.() ?? r.value ?? '').toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(a) && !/^0x0+$/.test(a) ? a : undefined;
  } catch { return null; }
}

/**
 * Who this app is acting as, and the mask behind it.
 *
 * The mask is found by walking, in parallel batches, because Masks has no
 * owner-to-id index. Bounded: a person has one mask, and scanning forever to
 * prove they have none is worse than saying so.
 */
export async function whoAmI(): Promise<Answer<Identity>> {
  const s = await withTimeout(session());
  if (s === 'timeout' || !s) return null;
  if (!s.address) return undefined;

  const { AccountId } = await import('polkadot-api');
  const h160 = h160Of(AccountId().enc(s.address));

  try {
    const c = s.sdk.createContract(s.rt, MASKS, MASKS_ABI, {});
    // ONE read. The first version of this walked sixty masks comparing owners,
    // because I did not look at the ABI before writing it: `maskOf` had been
    // there the whole time.
    const r = await withTimeout<{ value?: unknown }>(c.maskOf.query(h160));
    if (r === 'timeout' || r?.value === undefined) return null;
    const mask = Number(r.value as bigint);
    if (!mask) return { address: s.address, h160, mask: null, handle: '' };
    const handle = await handleOfMask(mask);
    return { address: s.address, h160, mask, handle: handle ?? '' };
  } catch {
    return null;
  }
}

/** Contract options that actually sign. Pass this to `createContract`. */
export function signingOptions(s: Session): Record<string, unknown> {
  return s.manager ? { signerManager: s.manager, defaultOrigin: s.address } : {};
}

/**
 * Weights, explicit.
 *
 * The SDK's sizing dry run comes back short and reverts OutOfGas BEFORE the
 * wallet is ever raised, so the person sees a refusal with no prompt at all.
 * The ceiling is a normal extrinsic's, less a tenth.
 */
export const LIMITS = {
  gasLimit: { ref_time: 1_400_000_000_000n, proof_size: 5_000_000n },
  storageDepositLimit: 10n ** 18n,
};
export const MAX_LIMITS = {
  gasLimit: { ref_time: 1_439_887_500_000n, proof_size: 7_549_747n },
  storageDepositLimit: 10n ** 18n,
};
export const isOutOfGas = (why: string) => /OutOfGas/i.test(why);
