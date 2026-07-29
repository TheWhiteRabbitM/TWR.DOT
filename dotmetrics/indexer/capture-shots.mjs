/**
 * capture-shots.mjs — weekly, CI-only app thumbnail capture for dotmetrics.
 *
 * WHAT IT DOES
 *   Reads ../src/lib/discovered.json (the same directory the dashboard renders),
 *   selects every name that has a NON-EMPTY contenthash — i.e. a bundle actually
 *   exists to look at — loads its app in headless Chromium at a phone size,
 *   screenshots the viewport, downscales it to a small WebP thumbnail, and writes
 *   it to ../public/shots/<label>.webp. Finally it writes ../src/lib/shots.json
 *   mapping label -> { file, w, h, capturedAt }.
 *
 * WHY public/shots AND NOT Bulletin
 *   Bulletin writes are quota-constrained and expiring. A screenshot is not chain
 *   data; it is decoration. Committing the thumbnails under public/ means the
 *   EXISTING single site publish carries them — zero per-image transactions. A
 *   missing thumbnail is not an error: the UI falls back to the monogram exactly
 *   as it does for a missing icon, so a partial set is a first-class outcome.
 *
 * THE URL WE LOAD — decided against the codebase, not the brief
 *   The brief guessed `https://<label>.app.dev-dot.li/`. The codebase disagrees,
 *   unanimously: indexer/index-apps.mjs writes `url: https://<label>.dev-dot.li`
 *   for every admitted name, registry.ts hard-codes the same host for its
 *   fallbacks, and all 60 contenthash-bearing entries in discovered.json already
 *   carry `url: https://<label>.dev-dot.li`. So we do NOT reconstruct the URL at
 *   all — we load `entry.url`, the value the indexer already resolved. The
 *   indexer is the single source of truth for an app's gateway URL; if the
 *   convention ever changes, it changes there and this script follows with no
 *   edit. (For the rare pre-index fallback with no url, we reconstruct
 *   `https://<label>.dev-dot.li` — the documented devnet pattern.)
 *
 * RESILIENCE IS THE WHOLE GAME
 *   Most standalone app loads will disappoint: many expect the product shell,
 *   many render blank, many time out. Every one of those is SKIPPED cleanly with
 *   a stated reason, never a thrown job. The job goes red only on a genuine
 *   infrastructure failure — discovered.json unreadable, or Chromium refusing to
 *   launch — because "nothing renders standalone" and "the tool is broken" are
 *   different claims and only the second is worth waking someone for.
 *
 *   Guards, in order:
 *     - per-navigation timeout (SHOT_NAV_TIMEOUT_MS)
 *     - HTTP >= 400 from the gateway            -> skip, "HTTP <status>"
 *     - a flat/near-uniform screenshot          -> skip, "rendered blank/flat"
 *       (this is what catches the shell-expecting apps that paint one colour)
 *     - a whole-run wall-clock budget (SHOT_RUN_BUDGET_MS): apps not reached
 *       this run keep whatever thumbnail a prior run gave them; not an error.
 *
 * MERGE, DON'T CLOBBER
 *   shots.json is merged over the previous file. A name we FAILED to capture this
 *   run keeps last run's thumbnail (a stale shot beats a monogram; capturedAt
 *   makes the staleness legible). A name that left the directory, or lost its
 *   contenthash, is pruned from both the JSON and disk so the bundle never
 *   accumulates orphans. If the directory momentarily reports ZERO
 *   contenthash-bearing names — an upstream read glitch, not a real emptying — we
 *   refuse to prune the whole set and exit without touching anything.
 *
 * SIZE
 *   Each thumbnail targets <= SHOT_TARGET_BYTES (20 KB) via a WebP quality
 *   ladder; if even the floor quality is over, we keep it and WARN (never a
 *   silent oversize). Capture is capped to MAX_SHOTS newest-first; anything the
 *   cap drops is named in the log (never a silent truncation). The total bytes
 *   added to public/shots are reported every run.
 *
 * PLAYWRIGHT + SHARP ARE CI-ONLY
 *   Neither is in the app's package.json. The workflow installs them with
 *   `npm install --no-save`, so they never enter the app's dependency set or the
 *   built bundle. This script is invoked ONLY by .github/workflows/screenshots.yml.
 *
 *   node capture-shots.mjs
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISCOVERED = path.join(HERE, '..', 'src', 'lib', 'discovered.json');
const SHOTS_DIR = path.join(HERE, '..', 'public', 'shots');
const SHOTS_JSON = path.join(HERE, '..', 'src', 'lib', 'shots.json');

/** An integer tunable, overridable from the environment for CI experiments. */
const int = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const THUMB_WIDTH = int('SHOT_WIDTH', 480); // downscaled thumbnail width, px
const TARGET_BYTES = int('SHOT_TARGET_BYTES', 20 * 1024); // per-thumb soft ceiling
const MAX_SHOTS = int('MAX_SHOTS', 100); // captures attempted per run, newest-first
const NAV_TIMEOUT_MS = int('SHOT_NAV_TIMEOUT_MS', 15_000);
const SETTLE_MS = int('SHOT_SETTLE_MS', 3_000); // let the SPA paint after DOM ready
const IDLE_TIMEOUT_MS = int('SHOT_IDLE_TIMEOUT_MS', 5_000); // best-effort networkidle wait
const RUN_BUDGET_MS = int('SHOT_RUN_BUDGET_MS', 12 * 60 * 1000); // whole-run wall clock
const SOFT_TOTAL_BYTES = int('SHOT_SOFT_TOTAL_BYTES', 2 * 1024 * 1024); // warn past this

const VIEWPORT = { width: 390, height: 844 }; // an iPhone-ish phone frame

// How long to let the shell resolve a .dot name and fetch its bundle from
// Bulletin before giving up. Bulletin fetches are slow; a first capture caught
// the resolve screen still at 6%. Generous, because a captured spinner is worse
// than a skipped app.
const RESOLVE_BUDGET_MS = int('SHOT_RESOLVE_BUDGET_MS', 45_000);
const DEVICE_SCALE = 2; // capture at 2x (780px wide) so 480px downscale is crisp
const FLAT_STDEV = 3; // per-channel stdev below this == a blank/uniform render
const QUALITY_LADDER = [80, 68, 55, 42, 30, 22]; // WebP quality, walked down to hit target
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36';

/** A genuine failure: state it in words, flag it for CI, and stop the job. */
function die(msg) {
  console.error(`capture-shots FAILED: ${msg}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error::capture-shots: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.error(`! ${msg}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${msg}`);
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/** Compress one PNG screenshot to a WebP thumbnail no wider than THUMB_WIDTH. */
async function toWebp(png, label) {
  let best = null;
  for (const quality of QUALITY_LADDER) {
    best = await sharp(png)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (best.length <= TARGET_BYTES) return best;
  }
  warn(
    `${label}: thumbnail is ${(best.length / 1024).toFixed(1)} KB even at lowest quality — ` +
      `keeping it (over the ${(TARGET_BYTES / 1024) | 0} KB target)`,
  );
  return best;
}

async function main() {
  // --- load the directory -------------------------------------------------
  const dir = readJson(DISCOVERED, null);
  if (!dir || typeof dir !== 'object') {
    die(`could not read ${DISCOVERED} — the directory the shots are keyed to`);
  }

  const entries = Object.keys(dir)
    .filter((k) => k !== 'excluded')
    .map((k) => dir[k])
    .filter((e) => e && typeof e === 'object' && typeof e.label === 'string');

  // A name is captureable iff it has a non-empty contenthash — a bundle exists.
  const captureable = entries.filter(
    (e) => typeof e.contenthash === 'string' && e.contenthash.length > 0,
  );
  const currentLabels = new Set(captureable.map((e) => e.label));

  const existing = readJson(SHOTS_JSON, {});
  const existingCount = Object.keys(existing).length;

  // Refuse to wipe a healthy set on an upstream read glitch: if the directory
  // now reports NO contenthash-bearing names yet we hold thumbnails from before,
  // that is far likelier a bad read than 60 apps deleting their bundles at once.
  if (captureable.length === 0) {
    if (existingCount > 0) {
      warn(
        `discovered.json lists 0 names with a contenthash but shots.json holds ` +
          `${existingCount} — treating this as an upstream glitch, not a mass deletion. ` +
          `Nothing captured, nothing pruned.`,
      );
    } else {
      console.log('no names with a contenthash to capture, and no prior shots — nothing to do.');
    }
    process.exit(0);
  }

  // --- choose what to capture: newest registration first, capped ----------
  const byRecency = captureable
    .slice()
    .sort(
      (a, b) =>
        (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0) ||
        (b.firstSeenBlock ?? 0) - (a.firstSeenBlock ?? 0),
    );
  const selected = byRecency.slice(0, MAX_SHOTS);
  const cappedOut = byRecency.slice(MAX_SHOTS);
  console.log(
    `${captureable.length} names have a bundle; capturing ${selected.length} ` +
      `(cap ${MAX_SHOTS}, newest-first) at ${VIEWPORT.width}x${VIEWPORT.height}@${DEVICE_SCALE}x ` +
      `-> ${THUMB_WIDTH}px WebP.`,
  );
  if (cappedOut.length) {
    console.log(
      `NOT captured this run — over the ${MAX_SHOTS} cap: ` +
        cappedOut.map((e) => e.label).join(', '),
    );
  }

  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // Start the new map from prior thumbnails that are still valid: label still in
  // the directory AND the file still on disk. A capture below overwrites its
  // entry; a name we never reach keeps this carried-over one.
  const shots = {};
  for (const [label, meta] of Object.entries(existing)) {
    if (!currentLabels.has(label)) continue; // left the directory / lost its bundle
    if (!meta || typeof meta.file !== 'string') continue;
    if (fs.existsSync(path.join(SHOTS_DIR, path.basename(meta.file)))) shots[label] = meta;
  }

  // --- launch the browser (genuine failure if it won't come up) -----------
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (e) {
    die(`Chromium would not launch: ${e?.message ?? e}`);
  }
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(NAV_TIMEOUT_MS);

  // --- capture loop -------------------------------------------------------
  const started = Date.now();
  let captured = 0;
  let skipped = 0;

  const skip = (label, reason) => {
    skipped += 1;
    console.log(`  x ${label.padEnd(28)} skipped — ${reason}`);
  };

  for (let i = 0; i < selected.length; i += 1) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      const remaining = selected.slice(i);
      console.log(
        `run budget of ${(RUN_BUDGET_MS / 1000) | 0}s reached — ${remaining.length} apps ` +
          `not attempted this run (they keep any prior thumbnail): ` +
          remaining.map((e) => e.label).join(', '),
      );
      break;
    }

    const { label } = selected[i];
    // The <label>.dev-dot.li gateway is the ONLY thing that can render the app:
    // the DotNS contenthash is a `pad` manifest wrapper, not a servable web
    // root, so loading the raw CID from an IPFS gateway 404s on index.html —
    // only the shell knows how to unwrap it. The catch is the shell shows a
    // "Resolving <name>.dot…" screen while it fetches from Bulletin, and a first
    // capture caught exactly that (at 6%) for all 60 apps. So: load the gateway
    // URL, then POLL until the resolving screen clears and the app has actually
    // painted, before shooting.
    const url =
      typeof selected[i].url === 'string' && /^https:\/\//.test(selected[i].url)
        ? selected[i].url
        : `https://${label}.dev-dot.li`;

    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const status = resp ? resp.status() : 0;
      if (status >= 400) {
        skip(label, `HTTP ${status} from ${url}`);
        continue;
      }

      // Poll for the app to actually appear: the resolve marker gone AND some
      // real painted content. Bulletin fetches are slow, so give it up to
      // RESOLVE_BUDGET_MS. A page that never clears the resolve screen is a
      // slow/unavailable bundle, not a screenshot — skip it, do not ship the
      // spinner.
      const ready = await page
        .waitForFunction(
          () => {
            const t = (document.body?.innerText || '').trim();
            const resolving = /resolving|loading…|loading\.\.\.|caricamento/i.test(t);
            const painted = t.length > 40 || document.querySelectorAll('img,svg,canvas,button').length > 3;
            return !resolving && painted;
          },
          { timeout: RESOLVE_BUDGET_MS, polling: 500 },
        )
        .then(() => true)
        .catch(() => false);
      if (!ready) {
        skip(label, 'never cleared the resolving screen within budget');
        continue;
      }
      await page.waitForTimeout(SETTLE_MS);

      const shot = await page.screenshot({ type: 'png', fullPage: false });

      // Skip anything that painted essentially one flat colour: a blank SPA, an
      // error page, an app that needs the shell. Near-zero variance == nothing.
      const stats = await sharp(shot).stats();
      if (stats.channels.every((c) => c.stdev < FLAT_STDEV)) {
        skip(label, 'rendered blank/flat (likely needs the shell, or errored)');
        continue;
      }

      const webp = await toWebp(shot, label);
      const meta = await sharp(webp).metadata();
      fs.writeFileSync(path.join(SHOTS_DIR, `${label}.webp`), webp);
      shots[label] = {
        file: `shots/${label}.webp`,
        w: meta.width ?? THUMB_WIDTH,
        h: meta.height ?? 0,
        capturedAt: Math.floor(Date.now() / 1000),
      };
      captured += 1;
      console.log(
        `  ok ${label.padEnd(28)} ${meta.width}x${meta.height}  ${(webp.length / 1024).toFixed(1)} KB`,
      );
    } catch (e) {
      const reason =
        e?.name === 'TimeoutError'
          ? `load timed out after ${NAV_TIMEOUT_MS}ms`
          : (e?.message ?? String(e)).split('\n')[0];
      skip(label, reason);
    } finally {
      await page.close().catch(() => {});
    }
  }

  await context.close().catch(() => {});
  await browser.close().catch(() => {});

  // --- prune orphan files, write shots.json -------------------------------
  const keepFiles = new Set(Object.values(shots).map((m) => path.basename(m.file)));
  let pruned = 0;
  for (const f of fs.readdirSync(SHOTS_DIR)) {
    if (f === '.gitkeep' || !f.endsWith('.webp')) continue;
    if (!keepFiles.has(f)) {
      fs.rmSync(path.join(SHOTS_DIR, f));
      pruned += 1;
      console.log(`  - pruned orphan shots/${f}`);
    }
  }

  // Stable key order so an unchanged run produces a byte-identical file and no
  // needless commit.
  const ordered = {};
  for (const k of Object.keys(shots).sort()) ordered[k] = shots[k];
  fs.writeFileSync(SHOTS_JSON, JSON.stringify(ordered, null, 2) + '\n');

  // --- report -------------------------------------------------------------
  let total = 0;
  for (const m of Object.values(shots)) {
    const p = path.join(SHOTS_DIR, path.basename(m.file));
    if (fs.existsSync(p)) total += fs.statSync(p).size;
  }
  const carried = Object.keys(shots).length - captured;
  console.log(
    `\nshots.json: ${Object.keys(shots).length} thumbnails ` +
      `(${captured} captured this run, ${carried} carried from prior runs) · ` +
      `${skipped} skipped · ${pruned} pruned`,
  );
  console.log(`public/shots total on disk: ${(total / 1024).toFixed(1)} KB`);
  if (total > SOFT_TOTAL_BYTES) {
    warn(
      `public/shots is ${(total / 1024).toFixed(1)} KB, over the ${(SOFT_TOTAL_BYTES / 1024) | 0} KB ` +
        `soft budget — lower MAX_SHOTS or SHOT_TARGET_BYTES if the bundle is growing too large.`,
    );
  }
  console.log(`wrote ${SHOTS_JSON}\n      ${SHOTS_DIR}\\<label>.webp`);
  process.exit(0);
}

main().catch((e) => die(e?.stack ?? e?.message ?? String(e)));
