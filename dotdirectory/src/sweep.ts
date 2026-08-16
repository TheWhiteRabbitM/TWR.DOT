import { Contract } from 'ethers';
import { REGISTRY, nodeOf, sharedProvider } from './chain';

/**
 * Finding names nobody told us about, from the visitor's browser.
 *
 * DotNS is ENS-style: the registry is keyed by namehash and its events carry
 * the hash, never the text. So the chain cannot be asked what names exist â€” it
 * can only be asked who owns `namehash(x)` for an `x` you already have. That is
 * why discovery used to mean walking every block and scraping ascii out of raw
 * extrinsic bytes, and why the machine that did it falling three days behind
 * took the whole index with it.
 *
 * But the question runs the other way for free. A hash does not reverse, yet
 * `owner(namehash(x))` is a cheap view call for ANY x you care to invent â€” so
 * instead of asking the chain to list its names, we propose names and let it
 * confirm them. Guessing is a bad way to enumerate a namespace and a very good
 * way to enumerate a namespace you can generate good guesses for: the labels
 * already listed here tell you exactly what this ecosystem names things.
 *
 * MEASURED, NOT ASSUMED
 * 112 candidates per second against a public RPC with ethers' JSON-RPC batching
 * (676 tested in 6.0s from a browser). A 242-word first attempt found `browse`
 * â€” registered, and absent from the 208 names the block-scanning indexer had
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

/** Words this ecosystem plausibly names things after. Deliberately short â€” it
 *  ships to every visitor, and the variant generator below multiplies it. */
export const WORDS =
  'wallet swap stake nft dao vote chat mail news blog shop game play music video photo map chain block token coin bank pay send file drive note todo list wiki forum poll quiz art gallery market trade bet dice bridge oracle index search find explore browse docs help guide learn school course book read write draw paint code dev build test lab studio works forge craft make create tools box hub port link tree seed root leaf node net web site page home base camp zone world globe earth moon star sun sky cloud rain fire water wind wave river lake sea ocean mountain forest garden park city town street road path door key lock safe vault chest card deck hand eye face head heart mind soul ghost angel king queen knight wizard hunter ranger monk bard pixel byte bit hash salt honey milk bread cake soup rice corn apple orange lemon grape cherry berry peach melon mango dot polkadot para relay xcm sub substrate kusama paseo westend alice bob charlie treasury council gov governance referenda bounty tip crowdloan auction collator validator nominator staking parachain assets identity people proxy multisig recovery vesting utility batch feed stream live watch listen speak talk say tell ask answer reply post share like follow friend group team crew club guild party squad band show film movie story tale poem song beat tune note echo signal wire cable link mesh grid array stack queue heap loop jump step walk run fly swim dive climb ride drive sail fish hunt farm grow plant harvest cook bake brew pour drink eat feed sleep wake dream think know learn teach lead follow serve help save keep hold give take buy sell rent lend borrow owe pay earn spend save invest bet win lose draw tie score point rank level tier grade class order sort filter group merge split join cut paste copy move drop pick choose select mark tag label name title head foot side edge center core shell skin bone blood nerve brain gut \
shoot aim hit strike blast crash smash break fix patch guard shield sword arrow \
bow shot spark flash bolt storm thunder shadow light dark void space time clock \
hour day night week month year age era moon sky dawn dusk noon'.split(/\s+/);

/* Exported so scripts/discover.mjs can run the same tables without a second
   copy of the dictionary â€” two copies drift, and then the command line and the
   page disagree about what has already been tried. */

/** Affixes that turn a known label into a plausible neighbour. */
export const SUFFIXES = ['app', 'hub', 'dao', 'io', 'x', 'lab', 'net', 'chain'];
export const PREFIXES = ['my', 'the', 'go', 'get', 'on'];

/**
 * Stems this ecosystem compounds with, tried against the whole word list.
 *
 * Added after `polkashoot` â€” registered, deployed, self-described, and invisible
 * to both the block-scanning indexer and the first version of this sweep, which
 * only ever affixed short particles onto names it already knew. It could not
 * reach `polka` + `shoot` because `shoot` was in the dictionary and `polka` was
 * not a base. The names already listed said this pattern was productive
 * (dotmail, dotmetrics, dot-store, dotdirectory) and the generator ignored them.
 */
export const STEMS = ['dot', 'polka', 'sub'];

const LABEL_OK = /^[a-z0-9-]{3,32}$/;

/**
 * Build this visit's candidate list.
 *
 * `seed` rotates the slice â€” pass the chain head, so two visitors a block apart
 * sweep different words and the namespace gets covered by attrition rather than
 * by everyone repeating the first page of the dictionary.
 */
export function candidates(known: Set<string>, seed: number, budget = 700): string[] {
  const out: string[] = [];
  const push = (c: string) => {
    if (LABEL_OK.test(c) && !known.has(c) && out.length < budget) out.push(c);
  };

  // Bare dictionary words get the SMALLEST share, which is the opposite of the
  // first cut. A plain common word in a small ecosystem is usually owned by
  // nobody, while a stem compound is how these names are actually built.
  //
  // Measured over 40 seeds, not guessed: moving the compound share from 30% to
  // 50% of the budget took `polkashoot`'s reach from 20% of visits to 28%, and
  // `polkadao`/`dotswap`/`subwallet` land around 30%. So roughly one visit in
  // three reaches any given compound, and three or four visitors between them
  // reach it reliably â€” which is the whole bet: coverage by attrition rather
  // than by one machine trying to do it all.
  const start = Math.abs(seed) % WORDS.length;
  for (let i = 0; i < WORDS.length && out.length < budget * 0.3; i++) {
    push(WORDS[(start + i) % WORDS.length]);
  }

  // Compounds on this ecosystem's own stems. Cheap and productive: three stems
  // across the dictionary is where `polkashoot` lives, and where the affix-only
  // generator could never have reached.
  for (let i = 0; i < WORDS.length && out.length < budget * 0.8; i++) {
    const w = WORDS[(start + i) % WORDS.length];
    for (const stem of STEMS) if (w !== stem) push(stem + w);
  }

  // Then neighbours of what is already here â€” the highest-yield source, because
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
