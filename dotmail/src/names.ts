/**
 * names.ts — writing to a person instead of to 64 characters of hex.
 *
 * WHERE A KEY LIVES, AND WHY NOT IN THE CONTRACT
 *   DotMail has `keyOf(address)`, but it is indexed by `msg.sender`, and inside
 *   the app that is the HOST-DERIVED account for this product, not anybody's
 *   wallet. So resolving a name to its owner and asking the contract would look
 *   up the wrong address and answer "no mailbox" for somebody who has one. A
 *   silent wrong answer, which is the failure this project keeps meeting.
 *
 *   So a key is published under the NAME: a DotNS text record, exactly like the
 *   `manifest`, `category` and `screenshots` records every app here already
 *   carries. Only the name's owner can write it, so there is no ambiguity about
 *   which account it belongs to.
 *
 * PUBLISHING A KEY IS NOT A PRIVACY LOSS
 *   The key is meant to be public — it is how people write to you. What stays
 *   hidden is who wrote to whom, and that is untouched: the chain still holds
 *   nothing but anonymous envelopes.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sharedChain, withTimeout, READ_MS } from './conn.ts';

/** The DotNS content resolver. Read DIRECTLY, never through
 *  registry.resolver(), which is the trap dotmetrics documented. */
export const CONTENT_RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

/** The text record a mailbox key lives under. */
export const KEY_RECORD = 'dotmail';


const RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
    name: 'text',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * ENS-style namehash: start from 32 zero bytes and fold the labels in from the
 * right, hashing each label and concatenating. Implemented here rather than
 * pulled in with ethers, which would cost more than the whole app.
 */
export function nodeOf(rawName: string): string {
  // Accept either spelling here too, so a caller that forgot to normalise
  // cannot silently hash a name with an at sign in it and get a node that
  // resolves to nothing.
  const name = toDotted(rawName);
  // Copied into a fresh array each round rather than reassigned: keccak hands
  // back a Uint8Array over an ArrayBufferLike, and threading that through the
  // loop makes the type drift away from the plain Uint8Array everything else
  // here uses.
  let node = new Uint8Array(32);
  const labels = name.toLowerCase().replace(/^\.+|\.+$/g, '').split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    if (!labels[i]) continue;
    const joined = new Uint8Array(64);
    joined.set(node, 0);
    joined.set(keccak_256(enc.encode(labels[i])), 32);
    node = Uint8Array.from(keccak_256(joined));
  }
  return toHex(node);
}

/**
 * `alice@dotmailbox.dot` and `alice.dotmailbox.dot` are the SAME NAME.
 *
 * The at sign is a display convention, not a second naming system: DotNS
 * already has subnames, and `alice.dotmailbox.dot` is one. Writing it with an
 * `@` costs nothing, needs no registry of its own, and is the form every person
 * on earth already knows how to read and type.
 *
 * Everything downstream works on the dotted form, so the swap happens once,
 * here, at the edge.
 */
export const toDotted = (s: string) => s.trim().replace('@', '.').toLowerCase();

/** The friendly form: the first label becomes the local part. Only for
 *  DISPLAY — never feed this back into a lookup. */
export function toAtForm(name: string): string {
  const at = name.indexOf('.');
  return at < 0 ? name : `${name.slice(0, at)}@${name.slice(at + 1)}`;
}

export const looksLikeKey = (s: string) => /^[0-9a-f]{64}$/i.test(s.trim());

/** Accepts both spellings, and requires at least two labels either way. */
export const looksLikeName = (s: string) =>
  /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/i.test(toDotted(s))
  && (s.match(/@/g) ?? []).length <= 1;

export const keyFromHex = (s: string) =>
  new Uint8Array((s.trim().match(/../g) ?? []).map((b) => parseInt(b, 16)));

/**
 * The mailbox key published under a .dot name.
 *
 * `null` means the lookup could not be made; `undefined` means it was made and
 * the name has no key. The composer says two different things for those, and
 * conflating them would tell somebody a correspondent does not exist because a
 * node hiccuped.
 */
export async function keyForName(rawName: string): Promise<Uint8Array | null | undefined> {
  const name = toDotted(rawName);
  try {
    const c = await withTimeout(sharedChain(), READ_MS);
    if (c === 'timeout' || !c) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolver = c.sdk.createContract(c.rt, CONTENT_RESOLVER, RESOLVER_ABI as never, {}) as any;

    const r = await withTimeout<{ value?: unknown }>(resolver.text.query(nodeOf(name), KEY_RECORD), READ_MS);
    if (r === 'timeout' || r?.value === undefined) return null;
    const text = String(r.value ?? '').trim();
    if (!text) return undefined;                 // asked; nothing published
    return looksLikeKey(text) ? keyFromHex(text) : undefined;
  } catch {
    return null;
  }
}

/**
 * Publish your key under a name you own, from inside the app.
 *
 * WHY THIS HAS TO SIGN WITH THE WALLET ACCOUNT
 *   The record belongs to the name's owner, and the app's own product account
 *   owns nothing. So this signs with `getLegacyAccountSigner`, the user's real
 *   wallet — the same account that bought the name.
 *
 *   The first version of this screen skipped the problem by printing a `dotns`
 *   command instead. On a phone, inside the Polkadot app, there is no terminal
 *   to run it in: the instruction was addressed to precisely the person who
 *   could not follow it.
 *
 * WHEN IT CANNOT
 *   Some host builds answer `createTransactionWithLegacyAccount failed: Not
 *   implemented`. That is a real limitation and not something to hide, so it
 *   comes back as `hostCannot`, and only then does the interface fall back to
 *   showing the command for somebody with a desktop.
 */
export type PublishResult =
  | { ok: true }
  | { ok: false; hostCannot: boolean; why: string };

export async function publishKeyToName(rawName: string, keyHex: string): Promise<PublishResult> {
  const name = toDotted(rawName);
  try {
    const c = await withTimeout(sharedChain(), READ_MS);
    if (c === 'timeout' || !c) return { ok: false, hostCannot: true, why: 'no chain connection' };
    const accounts = await c.host.getAccountsProvider();
    if (!accounts) return { ok: false, hostCannot: true, why: 'there is no wallet here to sign with' };

    // `.match(ok, err)`. This is a neverthrow ResultAsync, so reading `.value`
    // off the awaited thing gives undefined and every account looks absent.
    const account = await accounts.getLegacyAccounts().match(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (as: any[]) => (as ?? []).find((a) => a?.publicKey) ?? null,
      () => null,
    );
    if (!account) {
      return { ok: false, hostCannot: true, why: 'this host did not offer a wallet account' };
    }
    const signer = accounts.getLegacyAccountSigner({ publicKey: account.publicKey, name: account.name });

    // `defaultSigner`, not `signer`: the option is named differently on the
    // contract factory than on a call, and passing the wrong one type-checks
    // nowhere and silently signs with nothing.
    const resolver = c.sdk.createContract(
      c.rt, CONTENT_RESOLVER, RESOLVER_ABI as never, { defaultSigner: signer } as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    // Explicit weights: the SDK's sizing dry run comes back short and reverts
    // before the wallet sheet is ever raised, so the user sees a refusal with
    // no prompt at all.
    const r = await resolver.setText.tx(nodeOf(name), KEY_RECORD, keyHex, {
      gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n },
      storageDepositLimit: 10n ** 18n,
      signer,
    });
    if (r?.ok === false) {
      const why = JSON.stringify(r).slice(0, 200);
      return { ok: false, hostCannot: /Not implemented|LegacyAccount/i.test(why), why };
    }

    // The receipt said yes. Ask the chain, because a write that came back ok
    // and changed nothing has happened here before.
    const back = await keyForName(name);
    if (back === null) return { ok: false, hostCannot: false, why: 'written, but the record could not be read back to confirm it' };
    if (back === undefined) return { ok: false, hostCannot: false, why: 'the write was accepted and the record is still empty' };
    return { ok: true };
  } catch (e) {
    const why = (e as Error)?.message ?? String(e);
    return { ok: false, hostCannot: /Not implemented|LegacyAccount/i.test(why), why };
  }
}

/** The desktop way, shown only when the app itself could not do it. */
export const publishCommand = (name: string, keyHex: string) =>
  `dotns text set ${toDotted(name)} ${KEY_RECORD} ${keyHex} --env devnet`;

/* ------------------------------------------------------- handles, chirp's way
 *
 * WHY NOT A SECOND REGISTRY
 *   Subnames under a domain we own are in OUR gift: whoever holds the parent can
 *   mint any child. Proof, from this afternoon: `claude.dotmailbox.dot` exists
 *   because we minted it, and nothing stopped us minting somebody else's name
 *   instead. A mail address handed out by us is not an identity, it is a
 *   favour, and it makes us the thing this whole project is against.
 *
 *   chirp already solved uniqueness: ChirpHandles maps a handle to exactly one
 *   mask, first come, and a mask has an owner. So dotmail reads THAT rather than
 *   inventing a rival list which would immediately disagree with it.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *   It proves the handle is unique and that one account holds it. It does NOT
 *   prove the holder is the same person as the People-chain username of the
 *   same spelling: Asset Hub cannot read the People chain, so nothing here can
 *   check that. chirp shows such a handle without a tick for exactly this
 *   reason, and so does this. A claim displayed as a fact is the failure mode.
 */
export const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
/** Mailbox keys, hung off the MASK so the three apps mean one person. */
export const DOTMAIL_KEYS = '0x9d03cc0f36d123f964b09cfb154458816817b5be';

/** The .dot the host scopes this app's derived account by. */
const APP_SCOPE = 'dotmailbox.dot';

const HANDLES_ABI = [
  {
    inputs: [{ name: 'h', type: 'bytes32' }], name: 'maskOfHandle',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
];
const HANDLES_READ_ABI = [
  {
    inputs: [{ name: 'mask', type: 'uint256' }], name: 'handleOf',
    outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function',
  },
];
const MASKS_ABI = [
  {
    inputs: [{ name: 'id', type: 'uint256' }], name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function',
  },
];

const KEYS_ABI = [
  {
    inputs: [{ name: 'mask', type: 'uint256' }], name: 'keyOf',
    outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'mask', type: 'uint256' }, { name: 'key', type: 'bytes32' }],
    name: 'setKey', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
];

/** A bare handle: no dots, no at sign. `watanabe`, not `watanabe.dot`. */
export const looksLikeHandle = (s: string) => /^[a-z0-9_.]{2,32}$/i.test(s.trim()) && !s.includes('@');


/**
 * The mask that holds a handle, and the mailbox key hanging off it.
 *
 * This is the whole point of DotMailKeys: chirp and peoplebook already agree
 * that a person IS a mask, so mail resolves through the same thing rather than
 * through an address that differs per app. Before this existed, zero of
 * eighteen mask owners had a key, which is what a second list buys you.
 */
export async function keyForHandle(handle: string): Promise<Uint8Array | null | undefined> {
  try {
    const c = await sharedChain();
    if (!c) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = c.sdk.createContract(c.rt, HANDLES, HANDLES_ABI as never, {}) as any;
    const hash = toHex(keccak_256(enc.encode(handle.trim().toLowerCase())));
    const m = await handles.maskOfHandle.query(hash);
    if (m?.value === undefined) return null;
    const mask = BigInt(m.value as bigint);
    if (mask === 0n) return undefined;             // asked; nobody holds it

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keys = c.sdk.createContract(c.rt, DOTMAIL_KEYS, KEYS_ABI as never, {}) as any;
    const k = await keys.keyOf.query(mask);
    if (k?.value === undefined) return null;
    const hex = String((k.value as { asHex?: () => string })?.asHex?.() ?? k.value ?? '');
    if (!hex || /^0x0+$/.test(hex)) return undefined;   // has a mask, no mailbox
    return keyFromHex(hex.replace(/^0x/, ''));
  } catch {
    return null;
  }
}

/**
 * The mask this signer owns, and its handle. `null` when nothing could be read.
 *
 * Walked rather than looked up, because Masks has no owner-to-id index. Bounded
 * at a sane number: a person has one mask, and scanning forever to prove they
 * have none is worse than saying so.
 */
export async function myMask(owner: string, upTo = 60): Promise<{ mask: number; handle: string } | null | undefined> {
  try {
    const c = await sharedChain();
    if (!c) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masks = c.sdk.createContract(c.rt, MASKS, MASKS_ABI as never, {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = c.sdk.createContract(c.rt, HANDLES, HANDLES_READ_ABI as never, {}) as any;
    const want = owner.toLowerCase();

    // In batches, not one at a time. Sixty sequential reads at a tenth of a
    // second each is six seconds of a screen saying "looking", which is how
    // this first appeared to hang.
    for (let from = 1; from <= upTo; from += 12) {
      const ids = Array.from({ length: Math.min(12, upTo - from + 1) }, (_, i) => from + i);
      const owners = await Promise.all(
        ids.map((id) => masks.ownerOf.query(BigInt(id)).catch(() => null)),
      );
      for (const [i, o] of owners.entries()) {
        if (o?.value === undefined) continue;
        const a = String((o.value as { asHex?: () => string })?.asHex?.() ?? o.value ?? '').toLowerCase();
        if (a !== want) continue;
        const id = ids[i];
        const h = await handles.handleOf.query(BigInt(id)).catch(() => null);
        return { mask: id, handle: String(h?.value ?? '').trim() };
      }
    }
    return undefined;                              // asked; this signer has none
  } catch {
    return null;
  }
}

/**
 * The WALLET address, which is what owns a mask.
 *
 * Not the product account: the host derives one of those per app, so the mask
 * chirp knows you by is owned by neither dotmail's account nor chirp's, but by
 * the wallet behind both. Looking for a mask under the product account was
 * guaranteed to find nothing, and the screen sat on "looking for your mask"
 * forever because of it.
 */
export async function walletAddress(): Promise<string | null> {
  try {
    const host = await import('@parity/product-sdk-host');
    const accounts = await host.getAccountsProvider();
    if (!accounts) return null;
    const a = await accounts.getLegacyAccounts().match(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (as: any[]) => (as ?? []).find((x) => x?.publicKey) ?? null,
      () => null,
    );
    if (!a?.publicKey) return null;

    // Same H160 rule pallet-revive uses: an eth-derived account keeps its first
    // twenty bytes, anything else is keccak'd.
    const pk: Uint8Array = a.publicKey;
    let ethDerived = pk.length === 32;
    if (ethDerived) for (let i = 20; i < 32; i++) if (pk[i] !== 0xee) { ethDerived = false; break; }
    const bytes = ethDerived ? pk.slice(0, 20) : keccak_256(pk).slice(12, 32);
    return toHex(bytes).toLowerCase();
  } catch {
    return null;
  }
}

/** Publish the mailbox key against a mask you own. */
/**
 * Write the key as somebody's PROXY.
 *
 * The host gives this app an account of its own, which owns no mask and so
 * cannot pass `ownerOf(mask) == msg.sender`. But if the person has made that
 * account a proxy of the account that DOES own the mask, the call can be built
 * unsigned and wrapped in `Proxy.proxy`, and the contract then sees the real
 * account as the caller.
 *
 * Which real account? Not guessed: read off `Proxy.Proxies` by looking for the
 * one that named us as a delegate. If there is more than one, none is chosen —
 * acting for the wrong person is worse than not acting.
 */
async function proxySetKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any, mask: number, keyHex: string,
): Promise<PublishResult> {
  try {
    const accounts = await c.host.getAccountsProvider();
    const signer = accounts?.getProductAccountSigner?.(APP_SCOPE)
      ?? accounts?.getProductAccountSigner?.();
    if (!signer) {
      return { ok: false, hostCannot: true, why: 'no wallet account, and no app account to act as your proxy either' };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me: any = await accounts.getProductAccount(APP_SCOPE).match((a: any) => a, () => null);
    if (!me?.publicKey) return { ok: false, hostCannot: true, why: 'the host would not name this app\'s account' };

    const api = c.rt?.client?.getUnsafeApi?.() ?? c.rt?.api;
    if (!api?.query?.Proxy?.Proxies) {
      return { ok: false, hostCannot: true, why: 'this build cannot read the proxy list' };
    }

    const ss58 = String(me.address ?? '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await api.query.Proxy.Proxies.getEntries();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = rows.filter((e: any) => (e?.value?.[0] ?? []).some((d: any) => String(d?.delegate) === ss58));
    if (mine.length !== 1) {
      return {
        ok: false,
        hostCannot: true,
        why: mine.length
          ? 'this app account is a proxy for more than one account, so none was chosen'
          : 'this host offers no wallet account, and this app account is nobody\'s proxy yet. In chirp, add it as a proxy of the account that owns your mask, and this will work.',
      };
    }
    const real = String(mine[0]?.keyArgs?.[0] ?? '');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keys = c.sdk.createContract(c.rt, DOTMAIL_KEYS, KEYS_ABI as never, {}) as any;
    const prepared = await keys.setKey.prepare(BigInt(mask), '0x' + keyHex, {
      gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n },
      storageDepositLimit: 10n ** 18n,
      origin: real,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner: any = (prepared as any)?.value ?? prepared;
    const call = inner?.decodedCall ?? inner?.call ?? inner;
    if (!call) return { ok: false, hostCannot: false, why: 'could not build the call to send through your proxy' };

    const res = await api.tx.Proxy.proxy({
      real: { type: 'Id', value: real },
      force_proxy_type: undefined,
      call,
    }).signAndSubmit(signer);
    if (res?.ok === false) {
      return { ok: false, hostCannot: false, why: JSON.stringify(res).slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, hostCannot: false, why: (e as Error)?.message ?? String(e) };
  }
}

export async function publishKeyToMask(mask: number, keyHex: string): Promise<PublishResult> {
  try {
    const c = await sharedChain();
    if (!c) return { ok: false, hostCannot: true, why: 'no chain connection' };
    const accounts = await c.host.getAccountsProvider();
    if (!accounts) return { ok: false, hostCannot: true, why: 'there is no wallet here to sign with' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // `.match(ok, err)`, NOT `.catch`: this returns a neverthrow ResultAsync,
    // which is thenable but is not a Promise, and calling .catch on it throws
    // "catch is not a function" — a crash where a refusal was intended.
    const account = await accounts.getLegacyAccounts().match(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (as: any[]) => (as ?? []).find((a) => a?.publicKey) ?? null,
      () => null,
    );

    // No wallet account on this host. Act as the mask owner's PROXY instead,
    // which is the route chirp already proved: the host signs with an account it
    // derives per app, and if that account has been made a proxy of the real
    // one, Proxy.proxy makes the contract see the real account as msg.sender.
    // Verified next door on a function gated on this very check.
    if (!account) return proxySetKey(c, mask, keyHex);

    const signer = accounts.getLegacyAccountSigner({ publicKey: account.publicKey, name: account.name });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keys = c.sdk.createContract(
      c.rt, DOTMAIL_KEYS, KEYS_ABI as never, { defaultSigner: signer } as never,
    ) as any;
    const r = await keys.setKey.tx(BigInt(mask), '0x' + keyHex, {
      gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n },
      storageDepositLimit: 10n ** 18n,
      signer,
    });
    if (r?.ok === false) {
      const why = JSON.stringify(r).slice(0, 200);
      return { ok: false, hostCannot: /Not implemented|LegacyAccount/i.test(why), why };
    }
    // Confirmed from the chain, never from the receipt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const read = c.sdk.createContract(c.rt, DOTMAIL_KEYS, KEYS_ABI as never, {}) as any;
    const back = await read.keyOf.query(BigInt(mask));
    const got = String((back?.value as { asHex?: () => string })?.asHex?.() ?? back?.value ?? '');
    if (!got || /^0x0+$/.test(got)) {
      return { ok: false, hostCannot: false, why: 'the write was accepted and the key still reads as empty' };
    }
    return { ok: true };
  } catch (e) {
    const why = (e as Error)?.message ?? String(e);
    return { ok: false, hostCannot: /Not implemented|LegacyAccount/i.test(why), why };
  }
}

/**
 * The mask behind a handle. One read, no wallet account, no scanning.
 *
 * Finding somebody's mask by walking every id and comparing owners needed the
 * wallet address, and getting that needs `getLegacyAccounts`, which some host
 * builds do not really offer. Asking the handle registry instead needs none of
 * that: the person knows their own name, and the registry answers in one call.
 * Ownership is checked where it matters anyway — the contract refuses a setKey
 * from anyone but the holder.
 */
export async function maskForHandle(handle: string): Promise<{ mask: number } | null | undefined> {
  try {
    const c = await withTimeout(sharedChain(), READ_MS);
    if (c === 'timeout' || !c) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = c.sdk.createContract(c.rt, HANDLES, HANDLES_ABI as never, {}) as any;
    const hash = toHex(keccak_256(enc.encode(handle.trim().toLowerCase())));
    const m = await withTimeout<{ value?: unknown }>(handles.maskOfHandle.query(hash), READ_MS);
    if (m === 'timeout' || m?.value === undefined) return null;
    const mask = Number(m.value as bigint);
    return mask > 0 ? { mask } : undefined;
  } catch {
    return null;
  }
}

/** The account that holds a handle, through chirp's registry.
 *  `null` could not ask, `undefined` nobody holds it. */
export async function accountForHandle(handle: string): Promise<string | null | undefined> {
  try {
    const c = await withTimeout(sharedChain(), READ_MS);
    if (c === 'timeout' || !c) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = c.sdk.createContract(c.rt, HANDLES, HANDLES_ABI as never, {}) as any;
    const hash = toHex(keccak_256(enc.encode(handle.trim().toLowerCase())));
    const m = await withTimeout<{ value?: unknown }>(handles.maskOfHandle.query(hash), READ_MS);
    if (m === 'timeout' || m?.value === undefined) return null;
    const mask = BigInt(m.value as bigint);
    if (mask === 0n) return undefined;              // asked; nobody holds it

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masks = c.sdk.createContract(c.rt, MASKS, MASKS_ABI as never, {}) as any;
    const o = await masks.ownerOf.query(mask);
    if (o?.value === undefined) return null;
    const owner = String((o.value as { asHex?: () => string })?.asHex?.() ?? o.value ?? '');
    return owner && !/^0x0+$/.test(owner) ? owner : undefined;
  } catch {
    return null;
  }
}
