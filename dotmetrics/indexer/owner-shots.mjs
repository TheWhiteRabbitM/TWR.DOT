/**
 * owner-shots.mjs — capture the OWNER screenshots our publication guidelines ask
 * every app to declare.
 *
 * Distinct from capture-shots.mjs on purpose: that one makes small fallback
 * thumbnails for the directory, weekly, from the gateway. These are the shots an
 * owner declares in the `screenshots` text record — bigger, current, and taken
 * from the freshly built dist rather than from whatever the gateway last cached,
 * because a stale screenshot presented as the app is a quiet lie.
 *
 * Serves each app's dist/ on a local port (no dependency on the gateway being
 * up), waits for the chain reads to settle, and takes two frames: the top of
 * the app, and one viewport down — enough to show it is an app and not a
 * landing page. Output: <app>/shots/store-1.webp, store-2.webp (1080px wide).
 *
 *   node indexer/owner-shots.mjs            # all apps below
 *   node indexer/owner-shots.mjs chirp      # one app, by directory name
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A second view worth showing, for apps where scrolling gives nothing.
 *
 * An empty inbox has nothing below the fold, so the second frame came back
 * byte-identical and was dropped, leaving a one-picture listing. Clicking to a
 * genuinely different screen is what a second screenshot is for.
 */
const SECOND_VIEW = {
  dotmail: () => document.getElementById('mailboxbtn')?.click(),
};

/** Directory name -> settle time. Apps that read the chain need longer. */
const APPS = {
  thebutton: 16_000,
  openpetition: 16_000,
  dotmetrics: 12_000,
  wudcommunity: 16_000,
  italiarovente: 10_000,
  truereviews: 16_000,
  'dot-store': 12_000,
  chirp: 18_000,
  ethonchain: 6_000,
  // dotmail derives a key and scans the whole envelope stream before it can
  // draw an inbox, so it needs longer than a page that only reads.
  dotmail: 20_000,
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function serve(dir) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let f = path.join(dir, p === '/' ? 'index.html' : p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html');
    res.setHeader('content-type', MIME[path.extname(f)] ?? 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

/** A frame that is one flat colour is a failed capture, not a screenshot. */
async function flat(buf) {
  const { data } = await sharp(buf).resize(24, 24, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let min = 255, max = 0;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  return max - min < 12;
}

const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});

for (const [app, settle] of Object.entries(APPS)) {
  if (only && app !== only) continue;
  const dist = path.join(ROOT, app, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.log(`${app}: no dist, skipped`); continue; }
  const srv = await serve(dist);
  const { port } = srv.address();
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(settle);
    const outDir = path.join(ROOT, app, 'shots');
    fs.mkdirSync(outDir, { recursive: true });
    let kept = 0;
    let previous = null;
    for (const [i, scroll] of [0, 1].entries()) {
      if (scroll && SECOND_VIEW[app]) {
        await page.evaluate(SECOND_VIEW[app]);
        await page.waitForTimeout(1500);
      } else if (scroll) {
        // Scroll the deepest thing that CAN scroll, not the window.
        //
        // dotmail keeps `overflow: hidden` on the body and scrolls its panes
        // instead, so window.scrollTo moved nothing and the second frame came
        // back byte-identical to the first. Two identical screenshots upload to
        // the SAME CID, which is how this was noticed at all.
        await page.evaluate(() => {
          const scrollable = [...document.querySelectorAll('*')]
            .filter((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY))
            .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
          if (scrollable) scrollable.scrollTop = scrollable.clientHeight;
          else scrollTo({ top: innerHeight, behavior: 'instant' });
        });
        await page.waitForTimeout(1200);
      }
      const raw = await page.screenshot({ type: 'png' });
      if (await flat(raw)) { console.log(`${app}: frame ${i + 1} came back flat, dropped`); continue; }
      // Shipping the same picture twice is not two screenshots, and a store
      // that shows it twice looks broken rather than thorough.
      if (previous && Buffer.compare(raw, previous) === 0) {
        console.log(`${app}: frame ${i + 1} is identical to the one before, dropped`);
        continue;
      }
      previous = raw;
      const out = path.join(outDir, `store-${kept + 1}.webp`);
      await sharp(raw).resize({ width: 1080 }).webp({ quality: 82 }).toFile(out);
      kept++;
    }
    console.log(`${app}: ${kept} shot${kept === 1 ? '' : 's'} -> ${app}/shots/`);
  } catch (e) {
    console.log(`${app}: capture failed — ${String(e?.message ?? e).slice(0, 90)}`);
  } finally {
    srv.close();
  }
}

await browser.close();
