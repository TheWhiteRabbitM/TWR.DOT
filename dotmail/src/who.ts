/**
 * who.ts — turning the account that paid into a person, and checking the name
 * on the letter against them.
 *
 * THE PROBLEM THIS EXISTS FOR
 *   `from` is written by the sender, inside the seal. It is a CLAIM. The one
 *   sender fact the chain records is who paid for the transaction. Until now the
 *   claim was the headline and the fact was small grey text, which is the wrong
 *   way round for the only field in a mail app anybody has ever forged.
 *
 * WHAT CAN ACTUALLY BE PROVED
 *   Handles live in chirp's registry: a handle maps to exactly one mask, and a
 *   mask has exactly one owner. So given a claimed handle and a payer, one
 *   lookup answers whether the account that paid is the account that holds that
 *   name. That is a real check, not a heuristic.
 *
 *   Three outcomes, and they are genuinely three:
 *     held      the payer holds the name it wrote. Say so, in green.
 *     mismatch  somebody else's name, on somebody else's letter. Say so, loudly.
 *     unknown   the chain could not be asked. Say NOTHING either way.
 *
 *   The third is why this is not a boolean. A node hiccup must never render as
 *   an accusation, and it must never render as a tick.
 *
 * AND THE SMALL THING THAT STARTED IT
 *   A sender with no handle had their forty-two character address printed where
 *   a name goes, which pushed the subject off the row. An address is shown short
 *   now, and looked up, because a great many of them do have a name.
 */
import { sharedChain, withTimeout, READ_MS } from './conn.ts';
import { HANDLES, MASKS, accountForHandle } from './names.ts';

/** A bare H160, with or without the prefix. */
export const looksLikeAddress = (s: string) => /^0x[0-9a-f]{40}$/i.test(s.trim());

/** A 32-byte mailbox key written out, which is what you type when you write to
 *  somebody who has no handle and no name. */
export const looksLikeKeyHex = (s: string) => /^(0x)?[0-9a-f]{64}$/i.test(s.trim());

/**
 * `0xc40cb64c…05305`. Long enough to compare two of them by eye, short enough
 * to sit in a table cell next to a subject line.
 *
 * Keys get the same treatment and say so, because a raw key is even longer
 * than an address: sixty four characters of it were being printed as the
 * recipient's name on every letter addressed by key.
 */
export function shortAddr(s: string): string {
  const a = s.trim();
  if (looksLikeAddress(a)) return `${a.slice(0, 8)}…${a.slice(-4)}`;
  if (looksLikeKeyHex(a)) {
    const h = a.replace(/^0x/i, '');
    return `key ${h.slice(0, 6)}…${h.slice(-4)}`;
  }
  return a;
}

/* ------------------------------------------------------------ address → name */

const MASKS_OF_ABI = [
  {
    inputs: [{ name: 'who', type: 'address' }], name: 'maskOf',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
];
const HANDLE_OF_ABI = [
  {
    inputs: [{ name: 'mask', type: 'uint256' }], name: 'handleOf',
    outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function',
  },
];

export type Who =
  | { kind: 'unknown' }                                  // could not ask
  | { kind: 'nobody' }                                   // asked; no mask
  | { kind: 'person'; mask: number; handle: string };    // asked; here they are

/**
 * Cached, and the failures are cached SEPARATELY — that is, not at all.
 *
 * Remembering `unknown` would freeze a momentary node failure into a permanent
 * "we do not know who this is" for the rest of the session, and the row would
 * never recover without a reload. Only answers are kept.
 */
const known = new Map<string, Who>();

export async function whoIs(address: string): Promise<Who> {
  const key = address.trim().toLowerCase();
  if (!looksLikeAddress(key)) return { kind: 'unknown' };
  const had = known.get(key);
  if (had) return had;

  try {
    const c = await withTimeout(sharedChain(), READ_MS);
    if (c === 'timeout' || !c) return { kind: 'unknown' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masks = c.sdk.createContract(c.rt, MASKS, MASKS_OF_ABI as never, {}) as any;
    const m = await withTimeout<{ value?: unknown }>(masks.maskOf.query(key), READ_MS);
    if (m === 'timeout' || m?.value === undefined) return { kind: 'unknown' };

    const mask = Number(m.value as bigint);
    if (!mask) {
      const answer: Who = { kind: 'nobody' };
      known.set(key, answer);
      return answer;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handles = c.sdk.createContract(c.rt, HANDLES, HANDLE_OF_ABI as never, {}) as any;
    const h = await withTimeout<{ value?: unknown }>(handles.handleOf.query(BigInt(mask)), READ_MS);
    // A mask with no handle is still a person, and knowing their mask number is
    // worth more than another line of hex.
    const handle = h === 'timeout' ? '' : String(h?.value ?? '').trim();

    const answer: Who = { kind: 'person', mask, handle };
    known.set(key, answer);
    return answer;
  } catch {
    return { kind: 'unknown' };
  }
}

/* ------------------------------------------------- does the name match the payer */

export type Verdict =
  /** The payer holds the name on the letter. */
  | { kind: 'held' }
  /** The letter is signed with a name this payer does not hold. */
  | { kind: 'mismatch'; realHolder: string | null }
  /** The name is the payer's own address, written out. True, and unremarkable. */
  | { kind: 'selfaddressed' }
  /** No name worth checking: no handle, or the chain could not be asked. */
  | { kind: 'unchecked' };

const judged = new Map<string, Verdict>();

/**
 * Check the claimed sender against the account that paid.
 *
 * Only handles can be checked, because only handles are registered. A claim
 * that is simply an address is compared directly, and anything else — a
 * free-typed name, an empty field — comes back `unchecked` rather than being
 * failed. Absence of proof is not proof of forgery, and rendering it as one
 * would put a red mark on every letter sent before handles existed.
 */
export async function checkSender(claimed: string, payer: string): Promise<Verdict> {
  const from = (claimed ?? '').trim();
  const paid = (payer ?? '').trim().toLowerCase();
  if (!from || !paid) return { kind: 'unchecked' };

  const cacheKey = `${from.toLowerCase()}|${paid}`;
  const had = judged.get(cacheKey);
  if (had) return had;

  // The plainest case: the letter is signed with the address that paid for it.
  if (looksLikeAddress(from)) {
    const v: Verdict = from.toLowerCase() === paid
      ? { kind: 'selfaddressed' }
      : { kind: 'mismatch', realHolder: null };
    judged.set(cacheKey, v);
    return v;
  }

  // A handle. `null` could not ask, `undefined` nobody holds it.
  const holder = await accountForHandle(from);
  if (holder === null) return { kind: 'unchecked' };          // NOT cached
  if (holder === undefined) {
    // Nobody holds this name at all. Not a forgery of a real person, but not
    // something to show as though the chain had confirmed it either.
    const v: Verdict = { kind: 'unchecked' };
    judged.set(cacheKey, v);
    return v;
  }

  const v: Verdict = holder.toLowerCase() === paid
    ? { kind: 'held' }
    : { kind: 'mismatch', realHolder: holder };
  judged.set(cacheKey, v);
  return v;
}

/**
 * The best name we can put on a letter, given what has been resolved so far.
 *
 * Synchronous on purpose: rendering must not wait on a chain read. It returns
 * the short form immediately and the real name once `whoIs` has filled the
 * cache, which is why the caller re-renders after resolving.
 */
export function nameNow(claimed: string, payer: string): string {
  const from = (claimed ?? '').trim();
  if (from && !looksLikeAddress(from)) return from;          // a handle, already a name

  const who = known.get((payer ?? '').trim().toLowerCase());
  if (who?.kind === 'person') return who.handle || `Mask ${who.mask}`;
  return shortAddr(from || payer || 'unknown');
}
