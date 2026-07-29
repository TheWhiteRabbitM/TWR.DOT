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

// How long to keep re-shooting a still-blank app iframe, and how often. The
// iframe is cross-origin, so there is no load event we can listen to — the
// screenshot itself is the only readiness signal available.
const PAINT_BUDGET_MS = int('SHOT_PAINT_BUDGET_MS', 30_000);
const PAINT_POLL_MS = int('SHOT_PAINT_POLL_MS', 2_500);

// Minimum percentage of the frame that must be content rather than background.
// Calibrated against all 60 captured apps, not guessed — see coverageOf().
const MIN_COVERAGE = Number(process.env.SHOT_MIN_COVERAGE ?? 2);
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

/**
 * Is the shell's fetch/resolve screen gone?
 *
 * A page-side expression rather than a function, so the same predicate can be
 * both waited on and re-checked without two copies drifting apart. "taking
 * longer" is in the list because that is the shell's own slow-fetch warning, and
 * a thumbnail of it is worse than no thumbnail.
 */
const LOADING_GONE = `(() => {
  const t = (document.body && document.body.innerText || '').toLowerCase();
  return !/fetching|resolving|loading|caricamento|verifying|taking longer|\\d+%/.test(t);
})()`;

/**
 * Click away any consent modal the shell has raised, choosing the refusing
 * option every time.
 *
 * Four languages because the shell follows the browser locale and a missed
 * dialog is a ruined thumbnail. Everything is best-effort: no dialog is the
 * normal case, and a failed click must never fail a capture.
 */
async function dismissConsent(page) {
  const refuse = /^(deny|nega|rifiuta|denegar|rechazar|refuser|refuse|not now|non ora)$/i;
  try {
    const buttons = await page.$$('button, [role="button"]');
    for (const b of buttons) {
      const label = ((await b.textContent().catch(() => '')) ?? '').trim();
      if (refuse.test(label)) {
        await b.click({ timeout: 1_500 }).catch(() => {});
        return true;
      }
    }
  } catch {
    /* no dialog, or the page navigated under us */
  }
  return false;
}

/**
 * What fraction of the frame is actually content, as a percentage?
 *
 * The flat-render check only catches a frame painted in ONE colour. It cannot
 * catch the frame that is 99% background with a small card on it — which is
 * exactly what an app's own transient state looks like: "Connecting…", or
 * "Couldn't connect — check your connection". Those states render inside the
 * cross-origin iframe, so there is no text we are allowed to read; the picture
 * is the only evidence available.
 *
 * So: find the modal colour with a coarse histogram, then count the pixels that
 * differ from it. Measured across all 60 captured apps, the separation is clean
 * and not a guess — 0.1% for a bare "Connecting…", 1.2% for an error card, then
 * a gap to 2.4% for a genuinely minimal but real page ("Hello, Devnet") and 4-47%
 * for everything else. The default threshold sits in that gap.
 */
async function coverageOf(png) {
  const { data, info } = await sharp(png).resize({ width: 120 }).raw().toBuffer({
    resolveWithObject: true,
  });
  const ch = info.channels;
  const n = info.width * info.height;
  const hist = new Map();
  for (let i = 0; i < n; i += 1) {
    const o = i * ch;
    const k = ((data[o] >> 5) << 6) | ((data[o + 1] >> 5) << 3) | (data[o + 2] >> 5);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bestK = 0;
  for (const [k, v] of hist) if (v > best) [best, bestK] = [v, k];
  const br = ((bestK >> 6) & 7) * 32 + 16;
  const bg = ((bestK >> 3) & 7) * 32 + 16;
  const bb = (bestK & 7) * 32 + 16;
  let ink = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * ch;
    if (Math.abs(data[o] - br) + Math.abs(data[o + 1] - bg) + Math.abs(data[o + 2] - bb) > 60) {
      ink += 1;
    }
  }
  return (ink / n) * 100;
}

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

  // Two ways to narrow the run, both for the same reason: most of the wall clock
  // goes on apps that never resolve, and re-shooting the ones that already work
  // buys nothing. SHOT_ONLY takes an explicit label list; SHOT_ONLY_MISSING
  // retries just the gaps. Neither can lose an existing thumbnail — `shots` is
  // seeded from the prior file below, so an unattempted name keeps what it had.
  const only = (process.env.SHOT_ONLY ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const onlyMissing = /^(1|true|yes)$/i.test(process.env.SHOT_ONLY_MISSING ?? '');

  let pool = byRecency;
  if (only.length) {
    const wanted = new Set(only);
    pool = byRecency.filter((e) => wanted.has(e.label));
    const unknown = only.filter((l) => !captureable.some((e) => e.label === l));
    if (unknown.length) warn(`SHOT_ONLY names with no bundle to capture: ${unknown.join(', ')}`);
    console.log(`SHOT_ONLY: restricted to ${pool.length} of ${byRecency.length} names.`);
  } else if (onlyMissing) {
    pool = byRecency.filter((e) => {
      const meta = existing[e.label];
      return !meta || typeof meta.file !== 'string'
        ? true
        : !fs.existsSync(path.join(SHOTS_DIR, path.basename(meta.file)));
    });
    console.log(
      `SHOT_ONLY_MISSING: ${pool.length} of ${byRecency.length} names have no thumbnail yet; ` +
        `the other ${byRecency.length - pool.length} keep theirs untouched.`,
    );
  }

  const selected = pool.slice(0, MAX_SHOTS);
  const cappedOut = pool.slice(MAX_SHOTS);
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
    // Service workers MUST be allowed. The shell registers host-sw.js and that
    // worker is what serves the app's bundle into the <label>.app.dev-dot.li
    // iframe — it is the transport, not an optimisation. Blocking it (the
    // default this script shipped with) produced two failure modes we spent a
    // run diagnosing: a wholly blank iframe, and — worse because it passed the
    // flat-render check — the app's HTML with none of its CSS, captured as an
    // unstyled serif page. Verified in a real browser: navigator.serviceWorker
    // .getRegistrations() on chainpulse.dev-dot.li returns host-sw.js, active.
    serviceWorkers: 'allow',
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
    // ?chainBackend=rpc-gateway is the whole difference between a fast capture
    // and a stall. Without it the shell defaults to light-client verification,
    // which is slow and parks headless on a "Fetching content · Use Trusted
    // Provider" screen; the param pre-selects the trusted RPC gateway, so the
    // app resolves in seconds instead of stalling. (Thanks to the operator for
    // spotting this.)
    const base =
      typeof selected[i].url === 'string' && /^https:\/\//.test(selected[i].url)
        ? selected[i].url
        : `https://${label}.dev-dot.li`;
    const url = base + (base.includes('?') ? '&' : '?') + 'chainBackend=rpc-gateway';

    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const status = resp ? resp.status() : 0;
      if (status >= 400) {
        skip(label, `HTTP ${status} from ${url}`);
        continue;
      }

      // The app renders inside a cross-origin iframe (<label>.app.dev-dot.li)
      // that the shell embeds after resolving the name and fetching the bundle
      // from Bulletin. We can't read across that origin, and the top document's
      // text is the shell chrome, not the app — reading it caught the spinner.
      // The clean cross-origin-safe signal, observed in a real browser: the shell
      // sets document.title to the app's own title once it loads (the tab goes
      // from "Polkadot — …" to e.g. "TrueReviews"). Wait for that.
      const ready = await page
        .waitForFunction(
          () => {
            const title = (document.title || '').trim();
            const titled = title.length > 0 && !/^polkadot\b/i.test(title);
            const hasAppFrame = !!document.querySelector('iframe[src*=".app.dev-dot.li"]');
            return titled && hasAppFrame;
          },
          { timeout: RESOLVE_BUDGET_MS, polling: 500 },
        )
        .then(() => true)
        .catch(() => false);
      if (!ready) {
        skip(label, 'shell never finished resolving the app within budget');
        continue;
      }

      // The shell's default is light-client verification, which is slow and
      // stalls headless at a "Fetching content … Use Trusted Provider" screen
      // that a human would click through. Click that shortcut ourselves if it
      // appears, so the app actually loads.
      await page
        .getByText(/trusted provider|provider attendibile|usa provider/i)
        .first()
        .click({ timeout: 4_000 })
        .catch(() => {});

      // Then wait for the loading/fetching screen to actually clear before
      // shooting — the title flips before the app has painted.
      //
      // This used to swallow its own timeout and shoot anyway, which is how a
      // thumbnail of "Fetching archive from IPFS gateway… 95% — This is taking
      // longer than expected" ended up on a product page. A progress screen has
      // plenty of pixel variance, so the flat-render check cannot catch it: the
      // only defence is to treat "still loading when time ran out" as a skip.
      const cleared = await page
        .waitForFunction(LOADING_GONE, { timeout: RESOLVE_BUDGET_MS, polling: 500 })
        .then(() => true)
        .catch(() => false);
      if (!cleared) {
        skip(label, `still fetching from the gateway after ${(RESOLVE_BUDGET_MS / 1000) | 0}s`);
        continue;
      }
      await page.waitForTimeout(SETTLE_MS);

      // Shoot the app iframe itself, so the thumbnail is the app and not the
      // shell chrome around it. Then keep shooting until it stops being blank:
      // the top document's loading text clears well before the iframe has
      // painted, and there is no cross-origin signal we can read to know when
      // it has. So the picture IS the readiness check — re-shoot on a cadence
      // and take the first frame with real variance in it. A fixed settle was
      // what shipped before, and it was simply too short for slower apps.
      let shot = null;
      let flat = true;
      let coverage = 0;
      const shootUntil = Date.now() + PAINT_BUDGET_MS;
      for (;;) {
        // Once the bundle actually loads (which it only started doing when we
        // stopped blocking the service worker), apps reach the point of asking
        // the shell for permissions — and the shell's modal lands on top of the
        // app, so the thumbnail became a screenshot of a consent dialog.
        //
        // Dismiss it, and dismiss it with DENY: this is a throwaway headless
        // browser with no user behind it, and the permission on offer is
        // "sign and submit on-chain transactions on your behalf". Granting that
        // to get a prettier picture would be indefensible even here. Apps show
        // their interface anyway and only need signing when someone acts.
        await dismissConsent(page);

        const appFrame = await page.$('iframe[src*=".app.dev-dot.li"]');
        const frame =
          (appFrame && (await appFrame.screenshot({ type: 'png' }).catch(() => null))) ||
          (await page.screenshot({ type: 'png', fullPage: false }));
        const stats = await sharp(frame).stats();
        // "Ready" is three conditions, not one: real variance in the picture,
        // enough of the frame actually covered in content, and no progress
        // screen still on it. A gateway that regresses to "fetching" mid-poll
        // must not be photographed just because the pixels moved.
        const stillLoading = !(await page.evaluate(LOADING_GONE).catch(() => true));
        coverage = await coverageOf(frame);
        flat =
          stats.channels.every((c) => c.stdev < FLAT_STDEV) ||
          coverage < MIN_COVERAGE ||
          stillLoading;
        // Keep the latest frame either way: if it never clears, the log says so
        // and nothing is written, but a later frame is never worse than an
        // earlier one.
        shot = frame;
        if (!flat || Date.now() >= shootUntil) break;
        await page.waitForTimeout(PAINT_POLL_MS);
      }

      // Never write a blank thumbnail. An app that needs more than the shell —
      // a wallet, a permission, an account — genuinely has nothing to show, and
      // the monogram is the honest fallback.
      if (flat) {
        skip(
          label,
          `nothing to photograph after ${((PAINT_BUDGET_MS + SETTLE_MS) / 1000) | 0}s ` +
            `(${coverage.toFixed(1)}% of the frame is content, needs ${MIN_COVERAGE}%) — ` +
            `likely its own loading or error state, or it needs more than the shell`,
        );
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
