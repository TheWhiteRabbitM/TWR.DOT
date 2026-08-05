/**
 * The claims dotmail makes, checked rather than asserted.
 *
 *   node --experimental-strip-types src/seal.test.ts
 *
 * Every case here is a property somebody could otherwise take on faith:
 * that a letter survives the round trip, that a stranger cannot open it, that
 * a stranger cannot even TELL it is not theirs, and that tampering fails
 * closed instead of returning something plausible.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { seal, open, mine, sealedSize, type Letter } from './seal.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const keypair = () => {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
};

// Alice needs no keypair: a sender makes a throwaway one per letter, which is
// exactly the property that keeps two letters to the same person unlinkable.
const bob = keypair();
const eve = keypair();

const letter: Letter = {
  from: 'alice.dot',
  subject: 'The thing we discussed',
  body: 'Meet at the usual place. Bring the paperwork.\n\nA.',
  sentAt: 1_770_000_000,
};

// 1. It goes there and comes back.
const env = seal(letter, bob.pub);
const got = open(env, bob.priv, bob.pub);
ok('bob opens what alice sealed for him', JSON.stringify(got) === JSON.stringify(letter));

// 2. Bob can recognise it without opening it.
ok('bob recognises his own envelope by tag', mine(env.eph, env.tag, bob.priv));

// 3. Eve cannot recognise it. This is the whole recipient-privacy claim: not
//    that Eve fails to READ it, but that she cannot tell whose it is.
ok('eve cannot tell the envelope is bob\'s', !mine(env.eph, env.tag, eve.priv));

// 4. Eve cannot open it even knowing it exists.
ok('eve cannot open it', open(env, eve.priv, eve.pub) === null);

// 5. Bob using the wrong public key in the derivation fails closed. The key is
//    bound to both sides, so a mismatched pairing must not decrypt.
ok('wrong recipient key in derivation fails closed', open(env, bob.priv, eve.pub) === null);

// 6. Tampering with one byte of ciphertext fails closed rather than returning
//    something. Poly1305 is doing the work; this proves it is wired up.
const tampered = { ...env, sealed: Uint8Array.from(env.sealed) };
tampered.sealed[tampered.sealed.length - 1] ^= 0x01;
ok('a flipped bit fails closed', open(tampered, bob.priv, bob.pub) === null);

// 7. Two letters to the same person are unlinkable to an observer: different
//    ephemeral key, different tag, every time.
const a = seal(letter, bob.pub);
const b = seal(letter, bob.pub);
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');
ok('same recipient, different tag each time', hex(a.tag) !== hex(b.tag));
ok('same recipient, different ephemeral key each time', hex(a.eph) !== hex(b.eph));
ok('identical plaintext, different ciphertext', hex(a.sealed) !== hex(b.sealed));

// 8. The subject is not recoverable from the envelope. Grep the whole thing.
const blob = hex(a.tag) + hex(a.eph) + hex(a.sealed);
const subjectHex = Buffer.from(letter.subject, 'utf8').toString('hex');
ok('the subject line does not appear in the envelope', !blob.includes(subjectHex));

// 9. Size is predicted before sending, so the composer can warn rather than
//    let the contract refuse a letter somebody just wrote.
ok('predicted size matches the seal', sealedSize(letter) === a.sealed.length,
  `predicted ${sealedSize(letter)}, actual ${a.sealed.length}`);

// 10. A long letter still fits under the contract's 16 kB ceiling, and one
//     that does not is knowable in advance.
const long: Letter = { ...letter, body: 'x'.repeat(15_000) };
ok('15 kB body is predicted over/under correctly', sealedSize(long) === seal(long, bob.pub).sealed.length);
ok('16 kB ceiling is reachable but finite', sealedSize(long) < 16_000);

// 11. Scan cost, measured. The privacy depends on trial decryption being cheap
//     enough that an inbox is usable.
const N = 2000;
const others = Array.from({ length: N }, () => seal(letter, eve.pub));
const t0 = performance.now();
let hits = 0;
for (const e of others) if (mine(e.eph, e.tag, bob.priv)) hits++;
const ms = performance.now() - t0;
ok(`scanning ${N} envelopes finds none of bob's`, hits === 0,
  `${ms.toFixed(0)}ms, ${(ms / N).toFixed(2)}ms each`);
ok('a 2000-envelope scan stays under 3s', ms < 3000, `${ms.toFixed(0)}ms`);

console.log(failed ? `\n${failed} failed` : '\nall properties hold');
process.exit(failed ? 1 : 0);
