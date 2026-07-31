/**
 * Report the health of the Bulletin storage-account pool.
 *
 * WHY THE POOL AND NOT OUR ACCOUNT
 *   `pad` never signs with our key. It draws a storage account from the
 *   `//deploy/0…N` pool, and Bulletin gates writes on that account's quota
 *   rather than on any balance. So the pool is the thing standing between
 *   every published app and the end of its retention window.
 *
 * WHAT MAKES THIS ACTIONABLE
 *   Two numbers matter and only one of them is obvious. The first is how many
 *   accounts are alive — pad picks one at random, so five dead out of ten is a
 *   coin-flip failure on every publish, which is what the retry wrapper in
 *   pad-publish.sh has been papering over. The second is the SOONEST expiry,
 *   not the average: the run that matters is the one that draws the account
 *   about to lapse.
 *
 *   Exits non-zero only when publishing is genuinely impossible (nothing left
 *   alive). A thinning pool is a warning, because the retries still land.
 */
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const live = [];
const dead = [];

for (const { address, status } of rows) {
  if (status && status.authorized && !status.expired) live.push({ address, ...status });
  else dead.push(address);
}

const days = (iso) => (Date.parse(iso) - Date.now()) / 86400000;

console.log(`pool: ${live.length} authorized, ${dead.length} not — of ${rows.length}\n`);
for (const a of live) {
  const mib = Number(a.bytes) / 1048576;
  console.log(
    `  LIVE  ${a.address}  ${a.transactions} tx, ${mib.toFixed(1)} MiB, ` +
      `expires ${a.expiresAt} (${days(a.expiresAt).toFixed(1)} days)`,
  );
}
for (const a of dead) console.log(`  DEAD  ${a}`);

if (!live.length) {
  console.log('::error::Every Bulletin storage pool account is unauthorized — nothing can be published, and every app falls off the network when its retention window closes');
  process.exit(1);
}

// The soonest expiry is the deadline, not the latest and not the average.
const soonest = live.reduce((a, b) => (days(a.expiresAt) < days(b.expiresAt) ? a : b));
const left = days(soonest.expiresAt);
console.log(`\nsoonest pool expiry: ${soonest.expiresAt} (${left.toFixed(1)} days)`);

// Retention is roughly a fortnight, so losing the pool with less than that left
// means apps start dropping before anyone can react.
if (left < 14)
  console.log(`::warning::Pool authorization expires in ${left.toFixed(1)} days — shorter than the ~14-day retention window, so published apps will start falling off unless it is renewed`);

if (dead.length >= rows.length / 2)
  console.log(`::warning::${dead.length} of ${rows.length} pool accounts are dead — pad picks at random, so publishes fail roughly that often and only succeed on retry`);
