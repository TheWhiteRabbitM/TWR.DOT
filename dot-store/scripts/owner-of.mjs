/**
 * Who owns a .dot name? A self-contained registry read.
 *
 * The publish job needs this as a guard: dot-store.dot has to exist before
 * anything can be published to it, and a scheduled workflow that fails every
 * hour against an unregistered name is noise that trains you to ignore the red
 * cross. So the job asks first, and skips with a clear line when the answer is
 * "nobody".
 *
 * Deliberately dependency-free beyond the keccak already in the tree: one
 * eth_call, one hand-rolled namehash. Pulling ethers in for a single 32-byte
 * hash would put a chain library into an app that has none.
 *
 *   node scripts/owner-of.mjs dot-store.dot
 *
 * Prints the owner address, or nothing at all when the name is unregistered.
 * Exits 0 either way — "unregistered" is an answer, not a failure. A read that
 * could not be performed exits 1, because that is genuinely different.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';

const REGISTRY = '0x527b08a640b527a3dae0C4BE04D7344E430B6E50';
const RPC = process.env.DEVNET_EVM_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';

/** keccak256 selector of `owner(bytes32)`. */
const OWNER_SELECTOR = '0x02571be3';

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const bytesOf = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

/**
 * ENS-style namehash: fold the labels right to left, hashing each label into the
 * accumulated node. `dot-store.dot` -> keccak(keccak(0x00…||keccak("dot"))||keccak("dot-store")).
 */
function namehash(name) {
  let node = new Uint8Array(32);
  const labels = name.split('.').filter(Boolean).reverse();
  for (const label of labels) {
    const labelHash = keccak_256(new TextEncoder().encode(label));
    const joined = new Uint8Array(64);
    joined.set(node, 0);
    joined.set(labelHash, 32);
    node = keccak_256(joined);
  }
  return hex(node);
}

const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/owner-of.mjs <name>.dot');
  process.exit(1);
}

const data = OWNER_SELECTOR + namehash(name);

let json;
try {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: REGISTRY, data }, 'latest'],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  json = await res.json();
} catch (e) {
  console.error(`owner-of: registry read failed: ${e?.message ?? e}`);
  process.exit(1);
}

if (json.error) {
  console.error(`owner-of: registry returned an error: ${JSON.stringify(json.error)}`);
  process.exit(1);
}

const word = String(json.result ?? '').replace(/^0x/, '');
if (word.length < 64) {
  console.error(`owner-of: unexpected registry reply: ${json.result}`);
  process.exit(1);
}

// An address is the low 20 bytes of the returned word. All-zero means the name
// has no owner — unregistered, which prints nothing: the caller tests for an
// empty string.
//
// No process.exit() here. Ending the process while undici is still tearing the
// connection down trips a libuv assertion on Windows, and a scary
// "Assertion failed" line in a CI log is worse than useless. Falling off the
// end exits 0 once the socket has closed itself.
const addr = word.slice(24, 64);
if (!/^0+$/.test(addr)) process.stdout.write(`0x${addr}\n`);
