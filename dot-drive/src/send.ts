/**
 * send.ts — handing somebody the key, through the post.
 *
 * THE CHOICE THAT MATTERS HERE
 *   A file's key could travel any number of ways. It travels as a LETTER,
 *   through the same DotMail contract dotmail already uses, for one reason:
 *   the envelope names no recipient. Any other channel that says "this key is
 *   for Alice" would undo the property the whole design exists for, since the
 *   blob on Bulletin is only unattributable while nothing points at it.
 *
 * WHY IT IS A LETTER AND NOT A NEW PAYLOAD KIND
 *   dotmail's scanner opens every envelope and asks `isPart(payload)`, then
 *   treats everything else as a letter. A brand new `kind` would therefore
 *   render in dotmail as a letter with no body: a working send that looks like
 *   a broken one, which is the worst failure available.
 *
 *   So this sends a REAL letter, whose body a person can read, carrying the
 *   machine-readable part in an extra field. dotmail today shows the words and
 *   ignores the field; dot-drive reads the field. Nothing has to be deployed
 *   in step, and an old client degrades to something true rather than to
 *   something blank.
 */
import { seal, sealedSize, type Letter } from './seal.ts';
import { ContractStore } from './chainstore.ts';
import { keyForName, keyForHandle, looksLikeKey, looksLikeName, looksLikeHandle, keyFromHex, accountForHandle, keyForMask } from './names.ts';
import { humanSize, type Stored } from './file.ts';

/** A letter that carries a file. The extra field is additive on purpose. */
export type FileLetter = Letter & { file?: Stored };

const MAX_SEALED = 16_000;

export type SendResult = { ok: true; note?: string } | { ok: false; why: string };

/**
 * Resolve a recipient the same three ways dotmail does, in the order that
 * cannot be wrong: a key IS the answer, a `.dot` name is looked up in the
 * resolver, a bare handle goes through chirp's registry to the mask.
 *
 * `null` means the lookup could not be made, `undefined` that it was made and
 * there is nobody. Collapsing those two tells somebody their correspondent
 * does not exist because a node hiccuped.
 */
export async function keyFor(to: string): Promise<{ key: Uint8Array } | { why: string }> {
  const t = to.trim();
  if (!t) return { why: 'Who is it for?' };

  if (looksLikeKey(t)) return { key: keyFromHex(t) };

  let pub: Uint8Array | null | undefined;
  if (looksLikeName(t)) pub = await keyForName(t);
  else if (looksLikeHandle(t)) pub = await keyForHandle(t);
  else return { why: `"${t}" is not a handle, a .dot name, or a 64-character key.` };

  if (pub === null) {
    return { why: `Could not look up "${t}". That is not the same as "no such mailbox" — try again.` };
  }
  if (pub === undefined) {
    if (looksLikeHandle(t)) {
      const account = await accountForHandle(t);
      return {
        why: account
          ? `@${t} exists but has not published a mailbox key yet, so there is nothing to seal to.`
          : `Nobody holds the handle @${t}. Handles are claimed in chirp.`,
      };
    }
    return { why: `${t} has no mailbox key published yet.` };
  }
  return { key: pub };
}

/** The words a person reads, so a client that knows nothing about files still
 *  shows something true and useful. */
function bodyFor(f: Stored, note: string): string {
  const when = new Date(f.expires).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  return [
    note.trim(),
    note.trim() ? '' : undefined,
    `${f.name} (${humanSize(f.size)}) is waiting in dot-drive.`,
    ``,
    `It is encrypted, and the key is in this letter, which is why this letter`,
    `is the thing worth keeping. Open it in dot-drive.`,
    ``,
    `The bytes stop being retrievable on ${when} unless somebody renews them.`,
  ].filter((l) => l !== undefined).join('\n');
}

/**
 * Seal the pointer and the key to the recipient AND to the sender's OWN
 * published mailbox.
 *
 * THE SECOND SLOT HAD THE WRONG KEY IN IT
 *   It used this app's derived mailbox, which felt right and was not. The host
 *   derives entropy per PRODUCT, and the product is the domain the bundle came
 *   from, so `dotmail:x25519:v1` under `dot-drive.dot` is a different key from
 *   the same label under `dotmailbox.dot`. The copy was sealed to a mailbox
 *   only dot-drive could open, which is a mailbox nobody reads: the file would
 *   reach the recipient and vanish from the sender's own Sent, with nothing on
 *   screen to explain it.
 *
 *   The right second reader is the key the sender PUBLISHED against their mask,
 *   because that is the one dotmail opens. It is read from the chain, not
 *   derived, for exactly the reason above.
 *
 *   When there is no published key the letter still goes, sealed to the
 *   recipient alone, and the caller is told plainly that the sender will not
 *   have their own copy. Silently dropping the second slot would be the same
 *   bug wearing a different coat.
 */
export async function sendFile(
  to: string,
  f: Stored,
  note: string,
  from: string,
  /** The sender's own mask, so their copy can be sealed to a key dotmail
   *  actually holds. `0` when we could not work out who we are. */
  myMask = 0,
): Promise<SendResult> {
  const found = await keyFor(to);
  if ('why' in found) return { ok: false, why: found.why };

  const mine = myMask ? await keyForMask(myMask) : undefined;
  const letter: FileLetter = {
    from,
    to,
    subject: f.name,
    body: bodyFor(f, note),
    sentAt: Math.floor(Date.now() / 1000),
    file: f,
  };
  if (sealedSize(letter as Letter) > MAX_SEALED) {
    return { ok: false, why: 'The note is too long to seal with the key.' };
  }

  const store = await ContractStore.open();
  if (!store) return { ok: false, why: 'No connection to the chain that carries the letters.' };

  // Two readers when we can, one when we cannot, and the difference is
  // reported rather than swallowed.
  const readers = mine ? [found.key, mine] : [found.key];
  const env = seal(letter as Letter, readers);
  const r = await store.send(env.tags, env.eph, env.sealed);
  if (!r.ok) return { ok: false, why: r.why ?? 'The letter did not send.' };

  return {
    ok: true,
    note: mine
      ? undefined
      : myMask
        ? 'Sent. You have no published mailbox key, so this one is not in your own dotmail: publish a key there and later sends will be.'
        : 'Sent. We could not work out which mask is yours, so your own copy was not sealed and this will not appear in your dotmail.',
  };
}
