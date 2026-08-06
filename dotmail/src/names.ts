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

const RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
    name: 'text',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
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
export function nodeOf(name: string): string {
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

export const looksLikeKey = (s: string) => /^[0-9a-f]{64}$/i.test(s.trim());
export const looksLikeName = (s: string) => /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/i.test(s.trim());

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
export async function keyForName(name: string): Promise<Uint8Array | null | undefined> {
  try {
    const host = await import('@parity/product-sdk-host');
    const { createClient } = await import('polkadot-api');
    const descriptors = await import('@parity/product-sdk-descriptors/devnet-asset-hub');
    const { createContractRuntimeFromClient, createContract } = await import('@parity/product-sdk/contracts');

    const provider = await host.getHostProvider(
      '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
    );
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

/** What somebody has to run to become reachable by their name. Shown rather
 *  than hidden, because the app cannot write this record itself: the record
 *  belongs to the name's owner, and the app signs as a product account that
 *  does not own it. */
export const publishCommand = (name: string, keyHex: string) =>
  `dotns text set ${name} ${KEY_RECORD} ${keyHex} --env devnet`;
