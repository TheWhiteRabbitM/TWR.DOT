/**
 * inbox.test.ts — the line that decides Inbox from Sent.
 *
 * Three letters this account had paid for sat in Inbox, and Sent was empty,
 * because the payer arrives from the chain EIP-55 checksummed and `me()` builds
 * its hex lowercase. The bytes matched; the strings never did.
 */
import { isMine } from './inbox.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const LOWER = '0xc40cb64c2ac0867d1037afd06cb53c8e02105305';   // what me() makes
const CHECKSUMMED = '0xC40cb64C2ac0867D1037AFd06cb53C8E02105305'; // what the chain returns
const OTHER = '0x8D4e81ab52bAd1dE1960e50E249513F7a2BFC95A';

// The regression itself.
ok('checksummed payer matches lowercase me', isMine(CHECKSUMMED, LOWER));
ok('lowercase payer matches checksummed me', isMine(LOWER, CHECKSUMMED));
ok('same case still matches', isMine(LOWER, LOWER));

// And it must not become permissive in the process.
ok('a different account is not me', !isMine(OTHER, LOWER));
ok('a different account is not me, either case', !isMine(OTHER.toLowerCase(), LOWER));

// Not knowing who we are means nothing is outgoing, never everything.
ok('unknown me claims nothing', !isMine(CHECKSUMMED, ''));
ok('missing payer claims nothing', !isMine('', LOWER));
ok('neither known claims nothing', !isMine('', ''));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
if (failed) throw new Error(`${failed} assertions failed`);
