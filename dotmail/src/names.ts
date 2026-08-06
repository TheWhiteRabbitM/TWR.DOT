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

/** The DotNS content resolver. Read DIRECTLY, never through
 *  registry.resolver(), which is the trap dotmetrics documented. */
export const CONTENT_RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

/** The text record a mailbox key lives under. */
export const KEY_RECORD = 'dotmail';

/** Devnet Asset Hub, where DotNS lives. */
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' as const;

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
    const host = await import('@parity/product-sdk-host');
    const { createClient } = await import('polkadot-api');
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const { createContractRuntimeFromClient, createContract } = await import('@parity/product-sdk/contracts');

    const provider = await host.getHostProvider(GENESIS);
    if (!provider) return null;

    const client = createClient(provider as never);
    const rt = createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolver = createContract(rt, CONTENT_RESOLVER, RESOLVER_ABI as any, {}) as any;

    const r = await resolver.text.query(nodeOf(name), KEY_RECORD);
    if (r?.value === undefined) return null;
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
    const host = await import('@parity/product-sdk-host');
    const { createClient } = await import('polkadot-api');
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const { createContractRuntimeFromClient, createContract } = await import('@parity/product-sdk/contracts');

    const accounts = await host.getAccountsProvider();
    if (!accounts) return { ok: false, hostCannot: true, why: 'there is no wallet here to sign with' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any = await accounts.getLegacyAccounts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = (list?.value ?? []).find((a: any) => a?.publicKey);
    if (!account) {
      return { ok: false, hostCannot: true, why: 'this host did not offer a wallet account' };
    }
    const signer = accounts.getLegacyAccountSigner({ publicKey: account.publicKey, name: account.name });

    const provider = await host.getHostProvider(GENESIS);
    if (!provider) return { ok: false, hostCannot: true, why: 'no chain connection' };

    const client = createClient(provider as never);
    const rt = createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
    // `defaultSigner`, not `signer`: the option is named differently on the
    // contract factory than on a call, and passing the wrong one type-checks
    // nowhere and silently signs with nothing.
    const resolver = createContract(
      rt, CONTENT_RESOLVER, RESOLVER_ABI as never, { defaultSigner: signer } as never,
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

/** One connection, reused by every lookup below. */
async function chain() {
  const host = await import('@parity/product-sdk-host');
  const { createClient } = await import('polkadot-api');
  const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
  const sdk = await import('@parity/product-sdk/contracts');
  const provider = await host.getHostProvider(GENESIS);
  if (!provider) return null;
  const client = createClient(provider as never);
  return { rt: sdk.createContractRuntimeFromClient(client, descriptors.devnet_asset_hub), sdk, host };
}

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
    const c = await chain();
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
    const c = await chain();
    if (!c) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masks = c.sdk.createContract(c.rt, MASKS, MASKS_ABI as never, {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = c.sdk.createContract(c.rt, HANDLES, HANDLES_READ_ABI as never, {}) as any;
    const want = owner.toLowerCase();
    for (let id = 1; id <= upTo; id++) {
      const o = await masks.ownerOf.query(BigInt(id)).catch(() => null);
      if (o?.value === undefined) continue;
      const a = String((o.value as { asHex?: () => string })?.asHex?.() ?? o.value ?? '').toLowerCase();
      if (a !== want) continue;
      const h = await handles.handleOf.query(BigInt(id)).catch(() => null);
      return { mask: id, handle: String(h?.value ?? '').trim() };
    }
    return undefined;                              // asked; this signer has none
  } catch {
    return null;
  }
}

/** Publish the mailbox key against a mask you own. */
export async function publishKeyToMask(mask: number, keyHex: string): Promise<PublishResult> {
  try {
    const c = await chain();
    if (!c) return { ok: false, hostCannot: true, why: 'no chain connection' };
    const accounts = await c.host.getAccountsProvider();
    if (!accounts) return { ok: false, hostCannot: true, why: 'there is no wallet here to sign with' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any = await accounts.getLegacyAccounts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = (list?.value ?? []).find((a: any) => a?.publicKey);
    if (!account) return { ok: false, hostCannot: true, why: 'this host did not offer a wallet account' };
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

/** The account that holds a handle, through chirp's registry.
 *  `null` could not ask, `undefined` nobody holds it. */
export async function accountForHandle(handle: string): Promise<string | null | undefined> {
  try {
    const host = await import('@parity/product-sdk-host');
    const { createClient } = await import('polkadot-api');
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const { createContractRuntimeFromClient, createContract } = await import('@parity/product-sdk/contracts');

    const provider = await host.getHostProvider(GENESIS);
    if (!provider) return null;
    const client = createClient(provider as never);
    const rt = createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = createContract(rt, HANDLES, HANDLES_ABI as never, {}) as any;
    const hash = toHex(keccak_256(enc.encode(handle.trim().toLowerCase())));
    const m = await handles.maskOfHandle.query(hash);
    if (m?.value === undefined) return null;
    const mask = BigInt(m.value as bigint);
    if (mask === 0n) return undefined;              // asked; nobody holds it

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masks = createContract(rt, MASKS, MASKS_ABI as never, {}) as any;
    const o = await masks.ownerOf.query(mask);
    if (o?.value === undefined) return null;
    const owner = String((o.value as { asHex?: () => string })?.asHex?.() ?? o.value ?? '');
    return owner && !/^0x0+$/.test(owner) ? owner : undefined;
  } catch {
    return null;
  }
}
