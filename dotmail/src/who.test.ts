/**
 * who.test.ts — the display half of sender identity, checked without a chain.
 *
 * The lookups need a node. The rules about what to PRINT do not, and those are
 * the part that broke: a forty-two character address landed where a name goes
 * and pushed the subject off the row. So the pure functions are pinned here.
 *
 * No `node:assert` import, and no `@types/node` in this project. The same tiny
 * `ok` helper seal.test.ts uses, for the same reason.
 */
import { shortAddr, looksLikeAddress, nameNow } from './who.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const ADDR = '0xc40cb64c2ac0867d1037afd06cb53c8e02105305';

/* ------------------------------------------------------------ looksLikeAddress */

ok('an H160 is an address', looksLikeAddress(ADDR));
ok('mixed case is still an address', looksLikeAddress('0xC40cb64C2ac0867D1037AFd06cb53C8E02105305'));
ok('a chirp handle is not an address', !looksLikeAddress('watanabe.01'));
ok('a .dot name is not an address', !looksLikeAddress('alice.dot'));
ok('empty is not an address', !looksLikeAddress(''));
ok('one nibble short is not an address', !looksLikeAddress(ADDR.slice(0, -1)));

/* -------------------------------------------------------------------- shortAddr */

ok('shortened to head and tail', shortAddr(ADDR) === '0xc40cb6…5305', shortAddr(ADDR));
ok('fits a table cell', shortAddr(ADDR).length < 16, `${shortAddr(ADDR).length} chars`);
ok('a name is left alone', shortAddr('watanabe.01') === 'watanabe.01');

/* ----------------------------------------------------------------------- nameNow
 *
 * Nothing is resolved in this process, so every case here is the FALLBACK path:
 * what the row shows in the instant before the chain answers, and for ever if
 * it never does.
 */
ok('a claimed handle is shown as written', nameNow('thewhiterabbitM.01', ADDR) === 'thewhiterabbitM.01');
ok('a sender with no handle is shortened', nameNow(ADDR, ADDR) === '0xc40cb6…5305', nameNow(ADDR, ADDR));
ok('an empty from falls back to the payer', nameNow('', ADDR) === '0xc40cb6…5305');
ok('nothing at all still says something', nameNow('', '') === 'unknown');

// The regression itself: no output may be long enough to break the row that broke.
const cases: [string, string][] = [[ADDR, ADDR], ['', ADDR], [ADDR, '']];
ok(
  'no fallback name is longer than 20 characters',
  cases.every(([f, p]) => nameNow(f, p).length <= 20),
  cases.map(([f, p]) => `${nameNow(f, p)}(${nameNow(f, p).length})`).join(' '),
);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
if (failed) throw new Error(`${failed} assertions failed`);
