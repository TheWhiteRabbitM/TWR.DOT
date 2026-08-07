/**
 * file.test.ts — the sealing, and the arithmetic about time.
 *
 * The expiry is the claim this app most needs to get right: it is called a
 * drive and it loses things in a fortnight, so every number it shows about
 * that is load-bearing.
 */
import { sealBytes, openBytes, sealedSize, timeLeft, isExpired, humanSize, RETENTION_MS } from './file.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ------------------------------------------------------------------ sealing */

const plain = new Uint8Array(100_000).map((_, i) => (i * 31 + (i >> 7)) & 0xff);
const { blob, key } = sealBytes(plain);

ok('the key is 32 bytes of hex', /^[0-9a-f]{64}$/.test(key), `${key.length} chars`);
ok('opens with its own key', same(openBytes(blob, key)!, plain));
ok('refuses a different key', openBytes(blob, '11'.repeat(32)) === null);
ok('refuses a short key', openBytes(blob, 'abcd') === null);
ok('refuses truncated bytes', openBytes(blob.slice(0, 10), key) === null);

// A single flipped byte must fail the tag, not decrypt to garbage.
const tampered = blob.slice();
tampered[tampered.length - 20] ^= 0x01;
ok('refuses one flipped byte', openBytes(tampered, key) === null);

ok('overhead is nonce plus tag', blob.length === plain.length + 40, `${blob.length - plain.length} bytes`);
ok('sealedSize predicts it', sealedSize(plain.length) === blob.length);

// Two seals of the same bytes must differ: a fresh key and nonce every time,
// or identical files would share a CID and be linkable to each other.
const second = sealBytes(plain);
ok('the same file seals differently twice', second.key !== key && !same(second.blob, blob));

/* --------------------------------------------------------------------- time */

const DAY = 86_400_000;
ok('retention is fourteen days', Math.round(RETENTION_MS / DAY) === 14, `${(RETENTION_MS / DAY).toFixed(2)} days`);

const now = 1_800_000_000_000;
ok('days when there are days', timeLeft(now + 13.2 * DAY, now) === '13 days left', timeLeft(now + 13.2 * DAY, now));
ok('hours when under two days', timeLeft(now + 5 * 3_600_000, now) === '5 hours left', timeLeft(now + 5 * 3_600_000, now));
ok('minutes when under two hours', timeLeft(now + 90 * 60_000, now) === '90 minutes left', timeLeft(now + 90 * 60_000, now));
ok('never says zero minutes', timeLeft(now + 1000, now) === '1 minute left', timeLeft(now + 1000, now));
ok('expired is expired', timeLeft(now - 1, now) === 'expired');
ok('the boundary counts as expired', isExpired({ expires: now }, now));
ok('one millisecond before does not', !isExpired({ expires: now + 1 }, now));

/* -------------------------------------------------------------------- sizes */

ok('bytes stay bytes', humanSize(900) === '900 B');
ok('kilobytes', humanSize(90_000) === '88 kB', humanSize(90_000));
ok('megabytes with a decimal', humanSize(1_820_000) === '1.7 MB', humanSize(1_820_000));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
if (failed) throw new Error(`${failed} assertions failed`);
