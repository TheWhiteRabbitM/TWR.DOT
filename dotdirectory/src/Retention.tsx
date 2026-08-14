/**
 * How long this page has left, and why that is a different question from how
 * long the directory has left.
 *
 * The names live in a contract on Asset Hub and pay no rent to anyone. What
 * used to expire is this bundle: Bulletin keeps data for fourteen days
 * (RetentionPeriod = 201,600 blocks, read from the live chain) and then drops
 * whatever has not been renewed. So the thing at risk was always the front end,
 * not the data — anyone could rebuild this page from the same two eth_calls —
 * but a front end that vanishes without warning still looks exactly like a
 * project that died.
 *
 * That risk is now the chain's problem rather than ours. Bulletin's runtime
 * carries `enable_auto_renew`, a recurring scheduler driven by its own
 * on_initialize and a block inherent, and every block of this bundle is
 * registered with it. No cron, no runner, no fee — the cost is storage
 * authorization quota, not tokens.
 *
 * WHY AGE AND NOT AN EXPIRY LOOKUP
 * Reading the registration back would mean a WebSocket to Bulletin and its
 * SCALE metadata in a page whose whole argument is that reading needs nothing.
 * Age is baked in at build time, needs no second connection, and answers the
 * only question a visitor can act on: whether what they are reading is current.
 * Past fourteen days it also proves the renewal fired — because if it had not,
 * there would be no page to read the claim on.
 */

declare const __BUILT_AT__: string;

const RETENTION_DAYS = 14;

const FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function Retention() {
  const built = new Date(__BUILT_AT__);
  if (Number.isNaN(built.getTime())) return null;

  const days = (Date.now() - built.getTime()) / 86_400_000;

  // Two states: inside the first retention window, or past it — which is the
  // interesting boundary, because past it the chain's auto-renewal is the only
  // reason this page still exists.
  const level = days > RETENTION_DAYS ? 'renewed' : 'fresh';

  const age = days < 1 ? 'today' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`;

  return (
    <p className={`retention ${level}`}>
      <span>
        published <strong>{FMT.format(built)}</strong> ({age})
      </span>
      {level === 'fresh' ? (
        <span>
          Bulletin drops unrenewed data after {RETENTION_DAYS} days; every block of this bundle is
          registered for the chain's own recurring auto-renewal, so nothing external renews it.
        </span>
      ) : (
        <span>
          Past its first {RETENTION_DAYS}-day boundary, so the chain's auto-renewal has fired at
          least once — if it had not, you would not be reading this. The directory does not depend
          on it either way: the names are in the contract, and any page can read them.
        </span>
      )}
    </p>
  );
}
