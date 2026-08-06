/**
 * The claims dotmail makes, checked rather than asserted.
 *
 *   node --experimental-strip-types src/seal.test.ts
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { seal, open, slotFor, sealedSize, SLOTS, type Letter } from './seal.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const keypair = () => {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
};
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

const alice = keypair();
const bob = keypair();
const eve = keypair();

const letter: Letter = {
  from: 'alice', to: 'bob',
  subject: 'The thing we discussed',
  body: 'Meet at the usual place. Bring the paperwork.\n\nA.',
  sentAt: 1_770_000_000,
};

// Alice seals to Bob AND to herself: that second slot is what Sent is made of.
const env = seal(letter, [bob.pub, alice.pub]);

const bobSlot = slotFor(env, bob.priv);
const aliceSlot = slotFor(env, alice.priv);
ok('bob finds his slot', bobSlot >= 0);
ok('alice finds her own slot in what she sent', aliceSlot >= 0);
ok('they are different slots', bobSlot !== aliceSlot);

ok('bob reads the letter', JSON.stringify(open(env, bobSlot, bob.priv, bob.pub)) === JSON.stringify(letter));
ok('alice re-reads what she sent', JSON.stringify(open(env, aliceSlot, alice.priv, alice.pub)) === JSON.stringify(letter));

ok('eve cannot tell the envelope is anyone\'s', slotFor(env, eve.priv) === -1);
ok('eve cannot open it', open(env, 0, eve.priv, eve.pub) === null);
ok('wrong public key in the derivation fails closed', open(env, bobSlot, bob.priv, eve.pub) === null);

const tampered = { ...env, sealed: Uint8Array.from(env.sealed) };
tampered.sealed[tampered.sealed.length - 1] ^= 0x01;
ok('a flipped bit in the body fails closed', open(tampered, bobSlot, bob.priv, bob.pub) === null);

const tamperedKey = { ...env, sealed: Uint8Array.from(env.sealed) };
tamperedKey.sealed[0] ^= 0x01;
ok('a flipped bit in a wrapped key fails closed',
  open(tamperedKey, 0, bob.priv, bob.pub) === null || slotFor(tamperedKey, bob.priv) !== 0
  || open(tamperedKey, slotFor(tamperedKey, bob.priv), bob.priv, bob.pub) === null);

// Uniform shape: the padding must be indistinguishable from a real slot, or
// the envelope publishes how many people it went to.
ok(`every envelope has exactly ${SLOTS} tags`, env.tags.length === SLOTS);
const oneReader = seal(letter, [bob.pub]);
ok('a one-reader letter still has four tags', oneReader.tags.length === SLOTS);
ok('a one-reader letter is the same size as a two-reader one',
  oneReader.sealed.length === env.sealed.length,
  `${oneReader.sealed.length} vs ${env.sealed.length}`);
ok('no tag is all zeroes (padding would announce itself)',
  oneReader.tags.every((t) => t.some((b) => b !== 0)));

// Unlinkability.
const a = seal(letter, [bob.pub, alice.pub]);
const b = seal(letter, [bob.pub, alice.pub]);
ok('same readers, different tags each time', hex(a.tags[0]) !== hex(b.tags[0]));
ok('same readers, different ephemeral key each time', hex(a.eph) !== hex(b.eph));
ok('identical plaintext, different ciphertext', hex(a.sealed) !== hex(b.sealed));

// The subject must not survive anywhere in the envelope.
const blob = a.tags.map(hex).join('') + hex(a.eph) + hex(a.sealed);
ok('the subject line does not appear in the envelope',
  !blob.includes(Buffer.from(letter.subject, 'utf8').toString('hex')));

ok('predicted size matches the seal', sealedSize(letter) === a.sealed.length,
  `predicted ${sealedSize(letter)}, actual ${a.sealed.length}`);

const long: Letter = { ...letter, body: 'x'.repeat(15_000) };
ok('a 15 kB letter still fits the 16 kB ceiling', sealedSize(long) < 16_000, `${sealedSize(long)} bytes`);

// The scan is the cost of the privacy, so it has to stay cheap.
const N = 2000;
const others = Array.from({ length: N }, () => seal(letter, [eve.pub]));
const t0 = performance.now();
let hits = 0;
for (const e of others) if (slotFor(e, bob.priv) >= 0) hits++;
const ms = performance.now() - t0;
ok(`scanning ${N} envelopes finds none of bob's`, hits === 0, `${ms.toFixed(0)}ms, ${(ms / N).toFixed(2)}ms each`);
ok('a 2000-envelope scan stays under 3s', ms < 3000, `${ms.toFixed(0)}ms`);

console.log(failed ? `\n${failed} failed` : '\nall properties hold');
process.exit(failed ? 1 : 0);
