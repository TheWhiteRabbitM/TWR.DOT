import { Contract } from 'ethers';
import { REGISTRY, nodeOf, sharedProvider } from './chain';

/**
 * Finding names nobody told us about, from the visitor's browser.
 *
 * DotNS is ENS-style: the registry is keyed by namehash and its events carry
 * the hash, never the text. So the chain cannot be asked what names exist — it
 * can only be asked who owns `namehash(x)` for an `x` you already have. That is
 * why discovery used to mean walking every block and scraping ascii out of raw
 * extrinsic bytes, and why the machine that did it falling three days behind
 * took the whole index with it.
 *
 * But the question runs the other way for free. A hash does not reverse, yet
 * `owner(namehash(x))` is a cheap view call for ANY x you care to invent — so
 * instead of asking the chain to list its names, we propose names and let it
 * confirm them. Guessing is a bad way to enumerate a namespace and a very good
 * way to enumerate a namespace you can generate good guesses for: the labels
 * already listed here tell you exactly what this ecosystem names things.
 *
 * MEASURED, NOT ASSUMED
 * 112 candidates per second against a public RPC with ethers' JSON-RPC batching
 * (676 tested in 6.0s from a browser). A 242-word first attempt found `browse`
 * — registered, and absent from the 208 names the block-scanning indexer had
 * collected in three days of running. One find is not a triumph; it is proof
 * the method reaches somewhere the old one did not.
 *
 * WHY THIS IS THE PIECE THAT REMOVES THE LAST RUNNER
 * Reading was already view-time. Adding a name still needed a writer, so
 * discovery still needed a machine on a schedule. This makes discovery
 * view-time too: the work happens in the browser of whoever is looking, which
 * is exactly when anyone wants the answer. Nothing is cached, nothing is
 * persisted, nothing expires. The sweep costs a visitor six seconds of
 * background requests and costs the project nothing at all.
 *
 * Each visit sweeps a different slice, keyed off the chain head, so coverage
 * accumulates across visitors rather than everyone re-testing the same words.
 */

/** Words this ecosystem plausibly names things after. Deliberately short — it
 *  ships to every visitor, and the variant generator below multiplies it. */
const WORDS =
  'wallet swap stake nft dao vote chat mail news blog shop game play music video photo map chain block token coin bank pay send file drive note todo list wiki forum poll quiz art gallery market trade bet dice bridge oracle index search find explore browse docs help guide learn school course book read write draw paint code dev build test lab studio works forge craft make create tools box hub port link tree seed root leaf node net web site page home base camp zone world globe earth moon star sun sky cloud rain fire water wind wave river lake sea ocean mountain forest garden park city town street road path door key lock safe vault chest card deck hand eye face head heart mind soul ghost angel king queen knight wizard hunter ranger monk bard pixel byte bit hash salt honey milk bread cake soup rice corn apple orange lemon grape cherry berry peach melon mango dot polkadot para relay xcm sub substrate kusama paseo westend alice bob charlie treasury council gov governance referenda bounty tip crowdloan auction collator validator nominator staking parachain assets identity people proxy multisig recovery vesting utility batch feed stream live watch listen speak talk say tell ask answer reply post share like follow friend group team crew club guild party squad band show film movie story tale poem song beat tune note echo signal wire cable link mesh grid array stack queue heap loop jump step walk run fly swim dive climb ride drive sail fish hunt farm grow plant harvest cook bake brew pour drink eat feed sleep wake dream think know learn teach lead follow serve help save keep hold give take buy sell rent lend borrow owe pay earn spend save invest bet win lose draw tie score point rank level tier grade class order sort filter group merge split join cut paste copy move drop pick choose select mark tag label name title head foot side edge center core shell skin bone blood nerve brain gut'.split(
    ' ',
  );

/** Affixes that turn a known label into a plausible neighbour. */
const SUFFIXES = ['app', 'hub', 'dao', 'io', 'x', 'lab', 'net', 'chain'];
const PREFIXES = ['my', 'the', 'go', 'get', 'on'];

const LABEL_OK = /^[a-z0-9-]{3,32}$/;

/**
 * Build this visit's candidate list.
 *
 * `seed` rotates the slice — pass the chain head, so two visitors a block apart
 * sweep different words and the namespace gets covered by attrition rather than
 * by everyone repeating the first page of the dictionary.
 */
export function candidates(known: Set<string>, seed: number, budget = 700): string[] {
  const out: string[] = [];
  const push = (c: string) => {
    if (LABEL_OK.test(c) && !known.has(c) && out.length < budget) out.push(c);
  };

  // Dictionary first, rotated.
  const start = Math.abs(seed) % WORDS.length;
  for (let i = 0; i < WORDS.length && out.length < budget * 0.5; i++) {
    push(WORDS[(start + i) % WORDS.length]);
  }

  // Then neighbours of what is already here — the highest-yield source, because
  // whoever registered `dotmail` may well hold `dotdrive`.
  const listed = [...known];
  for (let i = 0; i < listed.length && out.length < budget; i++) {
    const base = listed[(start + i) % listed.length];
    for (const s of SUFFIXES) push(base + s);
    for (const p of PREFIXES) push(p + base);
  }

  // Whatever budget is left goes to the short namespace, which is exhaustible
  // in a way the rest is not: 17,576 three-letter labels, ~160 per visit.
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let n = Math.abs(seed) * 7919;
  while (out.length < budget) {
    const a = abc[n % 26];
    const b = abc[Math.floor(n / 26) % 26];
    const c = abc[Math.floor(n / 676) % 26];
    push(a + b + c);
    n++;
  }

  return out;
}

export interface Found {
  label: string;
  owner: string;
}

/**
 * Test candidates against the registry and return the ones that exist.
 *
 * Chunked rather than fired all at once: ethers batches within a chunk, and a
 * single 700-call Promise.all makes one request per candidate on any provider
 * whose batching is off, which is how a polite background sweep turns into a
 * denial of service against a public endpoint that is doing us a favour.
 */
export async function sweep(
  known: Set<string>,
  seed: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Found[]> {
  const { provider } = await sharedProvider();
  const registry = new Contract(REGISTRY, ['function owner(bytes32) view returns (address)'], provider);
  const list = candidates(known, seed);
  const found: Found[] = [];
  const CHUNK = 100;

  for (let i = 0; i < list.length; i += CHUNK) {
    if (signal?.aborted) break;
    const slice = list.slice(i, i + CHUNK);
    const owners = await Promise.all(
      slice.map((c) => registry.owner(nodeOf(c)).catch(() => null)),
    );
    slice.forEach((label, j) => {
      const owner = owners[j];
      if (owner && !/^0x0+$/i.test(String(owner))) found.push({ label, owner: String(owner) });
    });
    onProgress?.(Math.min(i + CHUNK, list.length), list.length);
  }

  return found;
}
