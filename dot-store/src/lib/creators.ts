import { DEVNET_EVM_RPC } from './config';

/**
 * Who made this app, as a person rather than an address.
 *
 * Every `.dot` in the catalog carries the H160 of whoever owns the name. That
 * is precisely the key PeoplebookMasks2 stores identities under — the same join
 * chirp does — so the two can be put together with no registry, no mapping file
 * and nobody's permission: owner address -> mask -> the name and handle that
 * mask published.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. A mask is bound to its account and
 * cannot be transferred, so a name shown here really is the one that account
 * published — it cannot be worn by someone else. It does NOT prove the person
 * is who the name says: the display name is free text and the People handle
 * cannot be checked from Asset Hub. Only a `.dot` the contract verified earns a
 * tick, and that is why one is shown separately from the other.
 *
 * Failure is silent by design: most owners have no mask, and an app whose
 * creator has not claimed one simply shows an address as before.
 */

const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';

// keccak-derived; the signature is beside each, as in chain.ts.
const SEL = {
  maskOf: '0x2497ab15', // maskOf(address)
  handleOf: '0x49491987', // handleOf(uint256)
  profileOf: '0x3e26d31e', // profileOf(uint256)
  verifiedName: '0x71b5594f', // verifiedName(uint256)
} as const;

const WORD = 64;
const pad = (v: string) => v.replace(/^0x/, '').toLowerCase().padStart(WORD, '0');
const u = (n: number | bigint) => pad(BigInt(n).toString(16));

function decodeString(hex: string, offsetWord = 0): string {
  // A single dynamic `string` return: word 0 is the offset, then length, then bytes.
  const at = Number(BigInt('0x' + hex.slice(2 + offsetWord * WORD, 2 + (offsetWord + 1) * WORD))) * 2 + 2;
  const len = Number(BigInt('0x' + hex.slice(at, at + WORD)));
  if (!len) return '';
  const body = hex.slice(at + WORD, at + WORD + len * 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

async function call(to: string, data: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(DEVNET_EVM_RPC, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: string };
    return typeof j.result === 'string' && j.result.length > 2 ? j.result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type Creator = {
  mask: number;
  /** The name they chose. Free text, proof of nothing — like a name on X. */
  name: string;
  /** Their People chain handle, if they linked one. Unique, but unprovable here. */
  handle: string;
  /** A `.dot` the masks contract checked against the registry. This earns a tick. */
  verified: string;
};

/** Resolved lookups, including the misses — most owners have no mask, and
 *  re-asking about the same absence on every render is a lot of nothing. */
const cache = new Map<string, Creator | null>();

export async function creatorOf(owner: string): Promise<Creator | null> {
  if (!owner || !owner.startsWith('0x')) return null;
  const key = owner.toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const maskHex = await call(MASKS, SEL.maskOf + u(BigInt(owner)));
  const mask = maskHex ? Number(BigInt(maskHex)) : 0;
  if (!mask) { cache.set(key, null); return null; }

  const [nameHex, handleHex, verifiedHex] = await Promise.all([
    call(MASKS, SEL.profileOf + u(mask)),
    call(HANDLES, SEL.handleOf + u(mask)),
    call(MASKS, SEL.verifiedName + u(mask)),
  ]);

  const out: Creator = {
    mask,
    // profileOf returns (displayName, telegram, x, bio) — the first is ours.
    name: nameHex ? decodeString(nameHex, 0) : '',
    handle: handleHex ? decodeString(handleHex, 0) : '',
    verified: verifiedHex ? decodeString(verifiedHex, 0) : '',
  };
  cache.set(key, out);
  return out;
}

/** How to address them: the handle they claimed, then a verified .dot, then the
 *  mask number — which says least but is the only one nobody could pick. */
export const creatorAt = (c: Creator) =>
  c.handle ? '@' + c.handle : c.verified ? '@' + c.verified + '.dot' : '@mask' + c.mask;

export const creatorName = (c: Creator) => c.name || c.handle || (c.verified ? c.verified + '.dot' : 'mask #' + c.mask);

/** Their timeline. The .dot address is used rather than a gateway URL so the
 *  link resolves for anyone, and the host routes it back into the app. */
export const creatorLink = (c: Creator) => `https://chirponchain.dot/#/u/${c.mask}`;
