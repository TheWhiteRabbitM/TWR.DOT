/**
 * DotNS reads over the plain public Ethereum JSON-RPC. Shared by the indexer
 * (ghost filter) and the enricher (records).
 *
 * Two facts about this devnet drive everything here:
 *
 *  1. A name only counts as REGISTERED if `registry.owner(namehash(label.dot))`
 *     is non-zero. The indexer finds candidate labels by scanning ascii runs in
 *     raw registration calldata, and that scan is generous — it also picks up
 *     random 4–6 char runs that were never names. `owner()` is the only
 *     authority on what exists.
 *
 *  2. `registry.resolver(node)` points at a DEAD resolver: `text()` and
 *     `contenthash()` revert on it. The live records are on the CONTENT
 *     RESOLVER below and must be called DIRECTLY. Never follow
 *     registry.resolver() — doing so silently makes every name look empty.
 *
 * Everything here is a read: no key, no host, no personhood.
 */
import { ethers } from 'ethers';

export const HTTP_RPC = process.env.ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
export const REGISTRY = '0x527b08a640b527a3dae0c4be04d7344e430b6e50';
/** Records live HERE, not on whatever registry.resolver() returns. */
export const CONTENT_RESOLVER = '0x326bdE29315199c814B1c58b431D84D16EA5cE41';

const REGISTRY_ABI = ['function owner(bytes32) view returns (address)'];
const RESOLVER_ABI = [
  'function text(bytes32,string) view returns (string)',
  'function contenthash(bytes32) view returns (bytes)',
];

let cached = null;

/** Shared provider. Batching is off: this RPC is happier with plain calls. */
export function contracts() {
  if (!cached) {
    const provider = new ethers.JsonRpcProvider(HTTP_RPC, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    cached = {
      provider,
      registry: new ethers.Contract(REGISTRY, REGISTRY_ABI, provider),
      resolver: new ethers.Contract(CONTENT_RESOLVER, RESOLVER_ABI, provider),
    };
  }
  return cached;
}

export const nodeOf = (name) => ethers.namehash(name);

/** Owner of `<label>.dot`, checksummed — or '' when the name is not registered. */
export async function ownerOf(label) {
  const { registry } = contracts();
  const owner = await registry.owner(nodeOf(`${label}.dot`));
  return owner && owner !== ethers.ZeroAddress ? ethers.getAddress(owner) : '';
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Split candidate labels into the ones the registry actually owns and the ones
 * it doesn't. A call that FAILS (RPC hiccup) is not evidence of a ghost, so it
 * is reported separately: the caller keeps such a label as-is rather than
 * deleting a real app because one HTTP request timed out.
 */
export async function verifyRegistered(labels, { concurrency = 6 } = {}) {
  const registered = new Map();
  const ghosts = [];
  const failed = [];
  await mapLimit(labels, concurrency, async (label) => {
    try {
      const owner = await ownerOf(label);
      if (owner) registered.set(label, owner);
      else ghosts.push(label);
    } catch {
      failed.push(label);
    }
  });
  return { registered, ghosts: ghosts.sort(), failed: failed.sort() };
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
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

/**
 * ENS-style contenthash bytes -> the `baf…` CID string.
 *
 * The record is `<ipfs-ns varint 0xe3 0x01><cid bytes>`; the CID itself is
 * already binary CIDv1, so the text form is multibase 'b' + base32 of it.
 * Anything that isn't ipfs-ns is returned as hex rather than guessed at.
 */
export function contenthashToCid(hex) {
  const raw = String(hex ?? '');
  if (!raw || raw === '0x') return '';
  const bytes = Uint8Array.from(Buffer.from(raw.replace(/^0x/, ''), 'hex'));
  if (bytes.length < 4) return '';
  if (bytes[0] === 0xe3 && bytes[1] === 0x01) return `b${base32(bytes.subarray(2))}`;
  return raw;
}
