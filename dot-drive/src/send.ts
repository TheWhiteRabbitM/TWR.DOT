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
import { mailbox } from './keys.ts';
import { keyForName, keyForHandle, looksLikeKey, looksLikeName, looksLikeHandle, keyFromHex, accountForHandle } from './names.ts';
import { humanSize, type Stored } from './file.ts';

/** A letter that carries a file. The extra field is additive on purpose. */
export type FileLetter = Letter & { file?: Stored };

const MAX_SEALED = 16_000;

export type SendResult = { ok: true } | { ok: false; why: string };

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
 * Seal the pointer and the key to the recipient AND to ourselves.
 *
 * The second slot is not an afterthought: a letter sealed only to its
 * recipient is one its sender can never read again, so the sending half of
 * dot-drive would forget which key it gave away the moment it was given.
 */
export async function sendFile(
  to: string,
  f: Stored,
  note: string,
  from: string,
): Promise<SendResult> {
  const found = await keyFor(to);
  if ('why' in found) return { ok: false, why: found.why };

  const box = await mailbox();
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

  const env = seal(letter as Letter, [found.key, box.pub]);
  const r = await store.send(env.tags, env.eph, env.sealed);
  return r.ok ? { ok: true } : { ok: false, why: r.why ?? 'The letter did not send.' };
}
