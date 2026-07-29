/**
 * The gate on directory transactions: upload the JSON and move the
 * `directory` record ONLY when the directory meaningfully changed.
 *
 * Every Bulletin write counts against a finite transaction quota, and the
 * hourly refresh used to upload the directory every run whether or not a
 * single byte of meaning had moved. This computes a digest of the SEMANTIC
 * content — names, records, tiers, liveness transitions — and skips both
 * transactions when it matches the last uploaded one.
 *
 * What is digested per name: label, domain, url, firstSeenBlock, owner,
 * manifest fields, contenthash, executable record, contract record, tier, and
 * `alive` (a liveness TRANSITION is a semantic change; a bundle going down is
 * news). What is NOT: timestamps. `lastSeenAliveAt` moves on every healthy
 * probe and `firstSeenAt`/`livenessCheckedAt` are bookkeeping — none of them
 * makes the directory say anything new, so none of them may cost a
 * transaction.
 *
 * The one exception to "unchanged → skip": Bulletin retention is a ~14-day
 * window, so an upload older than RENEWAL_DAYS is re-done even when identical —
 * half the window, with margin, same reasoning as keepalive.yml.
 *
 *   node directory-digest.mjs check
 *     Prints the decision; in GitHub Actions also writes `publish=true|false`,
 *     `digest=…` and `reason=…` to $GITHUB_OUTPUT.
 *
 *   node directory-digest.mjs commit <cid>
 *     Records digest + CID + upload time in state.json, after the upload and
 *     the record move both actually confirmed. Never called on a failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'apps.json');
const STATE = path.join(HERE, 'state.json');

/** Half the ~14-day retention window, with margin. */
const RENEWAL_DAYS = 5;

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/**
 * The digest, over a canonical projection of the file: labels sorted, fields
 * in a fixed order, absences normalised. Reordering keys in apps.json or
 * re-running the probe at a different second must never look like change.
 */
export function semanticDigest(file) {
  const labels = Object.keys(file)
    .filter((k) => k !== 'excluded')
    .sort();
  const doc = labels.map((label) => {
    const e = file[label];
    return [
      label,
      e.domain ?? '',
      e.url ?? '',
      e.firstSeenBlock ?? 0,
      e.owner ?? '',
      e.displayName ?? '',
      e.description ?? '',
      e.iconCid ?? '',
      e.contenthash ?? '',
      e.hasExecutable ?? false,
      e.contract ?? '',
      e.tier ?? 2,
      // The liveness TRANSITION, not its timestamps: null = never probed.
      e.alive === undefined ? null : e.alive,
    ];
  });
  doc.push([...(Array.isArray(file.excluded) ? file.excluded : [])].sort());
  return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

function githubOutput(pairs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, lines + '\n');
}

const [command, arg] = process.argv.slice(2);
const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const state = readJson(STATE, {});
const digest = semanticDigest(file);

if (command === 'check') {
  const last = state.directory ?? {};
  const ageDays = last.uploadedAt
    ? (Date.now() - Date.parse(last.uploadedAt)) / 86_400_000
    : Infinity;

  let publish = true;
  let reason;
  if (!last.digest) {
    reason = 'no upload on record yet';
  } else if (digest !== last.digest) {
    reason = `directory changed (was ${last.digest.slice(0, 12)}…, is ${digest.slice(0, 12)}…)`;
  } else if (ageDays >= RENEWAL_DAYS) {
    reason =
      `retention renewal: unchanged, but last upload was ${ageDays.toFixed(1)}d ago ` +
      `and Bulletin keeps objects ~14d`;
  } else {
    publish = false;
    reason =
      `unchanged since the upload ${ageDays.toFixed(1)}d ago ` +
      `(digest ${digest.slice(0, 12)}…) — skipping upload AND record set`;
  }

  console.log(`directory digest: ${digest}`);
  console.log(publish ? `PUBLISH — ${reason}` : `SKIP — ${reason}`);
  githubOutput({ publish, digest, reason });
} else if (command === 'commit') {
  if (!arg || !/^baf[a-z0-9]{50,}$/.test(arg)) {
    console.error('usage: node directory-digest.mjs commit <directory-cid>');
    process.exit(1);
  }
  state.directory = { digest, cid: arg, uploadedAt: new Date().toISOString() };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log(`recorded upload: ${arg} (digest ${digest.slice(0, 12)}…) → ${STATE}`);
} else {
  console.error('usage: node directory-digest.mjs check | commit <cid>');
  process.exit(1);
}
