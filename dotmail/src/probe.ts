/**
 * probe.ts — what can this app reach that it has no business reaching.
 *
 * WHY THIS EXISTS
 *   Every app in this suite holds something that matters: dotmail holds the
 *   private key to your correspondence, dot-drive holds the key to every file
 *   you ever put up, and dotmail's ordinary-mail panel holds an actual email
 *   server password. All three sit behind host APIs whose isolation we have
 *   assumed and never checked.
 *
 * THE TWO DOCUMENTS DISAGREE, WHICH IS WHY THIS IS A TEST AND NOT A READ
 *   `@parity/product-sdk-host` says entropy is derived from "the user's wallet
 *   + the provided context key". The protocol spec in `@parity/truapi` says it
 *   comes from "product-scoped seed material and context", and that repeated
 *   calls with the same context "for the same product" match.
 *
 *   If the SDK's wording is the true one, then any app that knows the string
 *   `dotmail:x25519:v1` derives dotmail's mailbox key and reads everything.
 *   If the protocol's wording is true, it cannot. Nothing outside the
 *   container can tell you which, so this asks.
 *
 * NOTHING SECRET IS EVER PRINTED
 *   The entropy check reports the X25519 PUBLIC key derived from the private
 *   one. That is enough to compare two apps for equality and useless to an
 *   observer. Where a credential is found, only its length is reported. A
 *   diagnostic that leaks while testing for leaks would be a poor joke.
 */
import { x25519 } from '@noble/curves/ed25519.js';

export type Finding = {
  name: string;
  /** `true` reached it, `false` refused, `null` could not run the test. */
  reached: boolean | null;
  detail: string;
  /** Whether reaching it would be a leak, as opposed to expected. */
  concern: 'leak' | 'expected' | 'unknown';
};

const enc = new TextEncoder();
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The host module, or null when there is no host to talk to.
 *
 * The import SUCCEEDS outside the container: the package is in the bundle
 * either way. So a plain `import` is not the test, and using it as one made
 * every check report "the host refused" when the truth was "there is nobody
 * to refuse". In a probe about isolation, mistaking absence for denial is the
 * one error that would make the whole output worthless.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function host(): Promise<any | null> {
  try {
    const h = await import('@parity/product-sdk-host');
    const inside = await h.isInsideContainer?.();
    return inside === false ? null : h;
  } catch {
    return null;
  }
}

/**
 * Derive under another app's label and report the PUBLIC key.
 *
 * Run this in two different apps. Same public key means the derivation is
 * scoped by something both apps share, and since both declare the same
 * `dappName`, that scope is a string an app chooses for itself. Different
 * public keys mean the scope is something an app cannot pick.
 *
 * Both answers matter and neither is good news on its own:
 *   same      any app declaring `peoplebook.dot` reads dotmail's letters.
 *   different dot-drive and dotmail have DIFFERENT mailbox keys, so a file
 *             dot-drive seals "to us" is one dotmail can never open.
 */
async function entropyScope(label: string): Promise<Finding> {
  const h = await host();
  if (!h?.deriveEntropy) {
    return { name: `deriveEntropy("${label}")`, reached: null, detail: 'no host here', concern: 'unknown' };
  }
  try {
    const r = await h.deriveEntropy(enc.encode(label));
    const bytes: Uint8Array | undefined = r?.ok ? r.value : undefined;
    if (!bytes || bytes.length < 32) {
      return { name: `deriveEntropy("${label}")`, reached: false, detail: 'the host refused', concern: 'unknown' };
    }
    const pub = x25519.getPublicKey(bytes.slice(0, 32));
    return {
      name: `deriveEntropy("${label}")`,
      reached: true,
      // The PUBLIC key. Comparable between apps, worth nothing to anybody else.
      detail: `public key ${hex(pub)}`,
      concern: 'unknown',
    };
  } catch (e) {
    return {
      name: `deriveEntropy("${label}")`,
      reached: null,
      detail: String((e as Error)?.message ?? e).slice(0, 90),
      concern: 'unknown',
    };
  }
}

/**
 * Read a key that belongs to a different app.
 *
 * `dotmail.jmap` is the sharpest one available: it holds the server, the
 * address and the APP PASSWORD for somebody's ordinary email account. If this
 * app can read it, the host's local storage is one shared bucket and every
 * app on the platform can read that credential.
 *
 * The value is never returned. Only whether it was there and how long it was.
 */
async function foreignKey(key: string, what: string): Promise<Finding> {
  const h = await host();
  const store = h?.getHostLocalStorage ? await h.getHostLocalStorage().catch(() => null) : null;
  if (!store) {
    return { name: `host storage read "${key}"`, reached: null, detail: 'no host storage here', concern: 'unknown' };
  }
  try {
    const v = await store.get(key);
    if (v === null || v === undefined || v === '') {
      return {
        name: `host storage read "${key}"`,
        reached: false,
        detail: 'empty or absent, which is what isolation looks like from here',
        concern: 'expected',
      };
    }
    return {
      name: `host storage read "${key}"`,
      reached: true,
      detail: `READ ${String(v).length} characters of ${what}. Value not shown.`,
      concern: 'leak',
    };
  } catch (e) {
    return {
      name: `host storage read "${key}"`,
      reached: false,
      detail: `refused: ${String((e as Error)?.message ?? e).slice(0, 70)}`,
      concern: 'expected',
    };
  }
}

/** Where the app is actually served from, which is what a real sandbox would
 *  scope things by. */
function originFinding(): Finding {
  return {
    name: 'origin',
    reached: true,
    detail: `${location.origin}${location.pathname}`,
    concern: 'expected',
  };
}

export async function runProbe(): Promise<Finding[]> {
  const out: Finding[] = [originFinding()];

  // Our own label first, as the control: it must always work.
  out.push(await entropyScope('dotmail:probe:v1'));
  // dotmail's real mailbox label. Same string dotmail uses.
  out.push(await entropyScope('dotmail:x25519:v1'));

  // Other apps' storage. dotmail's JMAP config is the one that holds a real
  // credential; the other two are ours and only prove the shape.
  out.push(await foreignKey('dot-drive.files', "another app's file list, which carries a decryption key per file"));
  out.push(await foreignKey('dotmail.jmap', 'this app own mail server credentials, as a control'));
  out.push(await foreignKey('chirp.settings', "another app's settings"));

  return out;
}

/** A block of text the user can paste into an issue or a message. */
export function asText(findings: Finding[]): string {
  const when = new Date().toISOString();
  const lines = findings.map((f) => {
    const mark = f.reached === true ? (f.concern === 'leak' ? 'LEAK' : 'YES ') : f.reached === false ? 'NO  ' : '??  ';
    return `[${mark}] ${f.name}\n        ${f.detail}`;
  });
  return [
    'dotmail sandbox probe',
    when,
    navigator.userAgent.slice(0, 110),
    '',
    ...lines,
    '',
    'Run the same probe in dot-drive and compare the two dotmail:x25519:v1 public keys.',
  ].join('\n');
}
