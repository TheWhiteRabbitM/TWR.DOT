import { namehash } from 'ethers';
import { readContract } from './chain';

/**
 * DotNS reads from the browser, over the same public JSON-RPC everything else
 * here uses. No wallet, no host, no personhood.
 *
 * Two rules this devnet imposes, learned the hard way:
 *
 *  1. A .dot name EXISTS only if `registry.owner(namehash(label + '.dot'))` is
 *     non-zero. The live tail finds names by scanning ascii runs in raw
 *     registration calldata, which cannot tell a name from a coincidence —
 *     `owner()` can.
 *
 *  2. `registry.resolver(node)` returns a DEAD resolver whose `text()` and
 *     `contenthash()` revert. Records live on the content resolver below and
 *     are read DIRECTLY from it.
 */
export const REGISTRY = '0x527b08a640b527a3dae0c4be04d7344e430b6e50';
export const CONTENT_RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

const ZERO = '0x0000000000000000000000000000000000000000';

const registry = () => readContract(REGISTRY, ['function owner(bytes32) view returns (address)']);
const resolver = () =>
  readContract(CONTENT_RESOLVER, [
    'function text(bytes32,string) view returns (string)',
    'function contenthash(bytes32) view returns (bytes)',
  ]);

/** Owner of `<label>.dot`, or '' when the name is not registered. */
export async function ownerOf(label: string): Promise<string> {
  const owner = String(await registry().owner(namehash(`${label}.dot`)) ?? '');
  return owner && owner.toLowerCase() !== ZERO ? owner : '';
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * ENS-style contenthash bytes -> `baf…` CID text. The record is an ipfs-ns
 * varint (0xe3 0x01) followed by the binary CIDv1, whose text form is
 * multibase 'b' + base32.
 */
export function contenthashToCid(hex: string): string {
  if (!hex || hex === '0x') return '';
  const body = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  if (bytes.length < 4 || bytes[0] !== 0xe3 || bytes[1] !== 0x01) return hex;
  let bits = 0;
  let value = 0;
  let out = 'b';
  for (const b of bytes.subarray(2)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export interface NameRecords {
  owner: string;
  displayName?: string;
  description?: string;
  iconCid?: string;
  contenthash?: string;
  hasExecutable: boolean;
  /** 1 published · 2 deployed · 3 name only. Tier 0 is decided by the reader map. */
  tier: 1 | 2 | 3;
}

/**
 * Everything the chain says about one name. Each record read stands alone: a
 * missing manifest never costs the contenthash.
 *
 * Returns null when the registry confirms there is no owner — the name is not a
 * registration. THROWS when the owner call itself fails, because a failed
 * request is not evidence that a name is fake; the caller retries instead of
 * blacklisting a real app.
 */
export async function readName(label: string): Promise<NameRecords | null> {
  const owner = await ownerOf(label);
  if (!owner) return null;

  const node = namehash(`${label}.dot`);
  const r = resolver();

  let manifest: { displayName?: unknown; description?: unknown; icon?: { cid?: unknown } } | null = null;
  try {
    const text = String((await r.text(node, 'manifest')) ?? '');
    if (text) manifest = JSON.parse(text);
  } catch {
    /* no manifest, or not JSON */
  }

  let contenthash = '';
  try {
    contenthash = contenthashToCid(String((await r.contenthash(node)) ?? ''));
  } catch {
    /* no contenthash record */
  }

  let hasExecutable = false;
  try {
    hasExecutable = Boolean(await r.text(namehash(`app.${label}.dot`), 'executable'));
  } catch {
    /* no executable record */
  }

  const displayName = typeof manifest?.displayName === 'string' ? manifest.displayName : undefined;
  const description = typeof manifest?.description === 'string' ? manifest.description : undefined;
  const iconCid = typeof manifest?.icon?.cid === 'string' ? manifest.icon.cid : undefined;

  return {
    owner,
    displayName,
    description,
    iconCid,
    contenthash: contenthash || undefined,
    hasExecutable,
    tier: displayName || description ? 1 : contenthash ? 2 : 3,
  };
}
