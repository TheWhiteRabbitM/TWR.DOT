/**
 * Walk the arcade the way a player would, and prove each cabinet works.
 *
 * WHY THIS ASKS THE CANVAS RATHER THAN THE CODE
 *   "The emulator started" is not the claim worth checking — a core that boots
 *   into a black screen passes that. So each cabinet is measured on what a
 *   player would see: frames advancing, and enough distinct colours on the glass
 *   that something is actually being drawn. Both come off the canvas.
 *
 * WHY THE ZOOM IS MEASURED, NOT EYEBALLED
 *   The walk-up is computed from live geometry, so a regression there shows up
 *   as a screen that ends up off-centre or barely bigger — invisible in a diff
 *   and obvious in a number. The chosen screen's rect is read before and after.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

/**
 * Hold a button for a beat, then let go.
 *
 * Playwright's `press` is down-and-up inside a millisecond or two. The
 * emulators sample input once per emulated frame — 16.7ms — so a press can fall
 * entirely between two samples and the game never sees it. Tobu Tobu Girl sat
 * on its credits card through eight of them because of exactly this.
 */
const hold = (p, code, ms = 160) =>
  p.keyboard
    .down(code)
    .then(() => p.waitForTimeout(ms))
    .then(() => p.keyboard.up(code));

const URL = process.argv[2] ?? 'http://localhost:5185';
mkdirSync('shots', { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.cab', { timeout: 15000 });

// Skip the shutter. Clicking to skip it would be a click the room has to not
// misread as choosing a cabinet, and four seconds per run adds up.
await p.evaluate(() => window.__arcade.openNow());
await p.waitForTimeout(800);
await p.screenshot({ path: 'shots/room.png' });

const cabinets = await p.evaluate(() => window.__arcade.cabinets);
console.log(`room: ${cabinets.length} cabinets\n`);

/**
 * What the emulator drew, at its own resolution.
 *
 * Deliberately NOT the visible canvas: that is 3x with scanlines and phosphor
 * glow on it, and a colour count taken there passes every game including a dead
 * one — the bloom alone invents hundreds of shades out of a black screen.
 */
const look = () => p.evaluate(() => window.__arcade.look());

const box = (i) =>
  p.$eval(`[data-screen="${i}"]`, (e) => {
    const r = e.getBoundingClientRect();
    return {
      w: r.width,
      h: r.height,
      ar: r.width / r.height,
      // A screen the walk-up pushed off the edge is not a screen you can play.
      fits: r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
    };
  });

let bad = 0;
for (let i = 0; i < cabinets.length; i++) {
  const cab = cabinets[i];
  if (!cab.rom) {
    console.log(`  ${i}. ${cab.title.padEnd(18)} empty`);
    continue;
  }

  const before = await box(i);
  await p.click(`[data-i="${i}"]`);
  await p.waitForTimeout(1200); // core chunk + ROM fetch + boot

  // Work the controls: a title screen that never gets a button looks dead.
  for (const k of ['Enter', 'Space', 'KeyZ', 'ArrowRight', 'Enter', 'KeyX', 'ArrowDown']) {
    await hold(p, k);
    await p.waitForTimeout(400);
  }

  const after = await box(i);
  const f0 = await p.evaluate(() => window.__arcade.frames());
  await p.waitForTimeout(1000);
  const f1 = await p.evaluate(() => window.__arcade.frames());
  const { colours, w, h } = await look();

  await p.screenshot({ path: `shots/cab-${i}-${cab.system}.png` });

  const fps = f1 - f0;
  const zoom = (after.w / before.w).toFixed(2);
  const shape = (w / h).toFixed(2);
  const drawn = after.ar.toFixed(2);
  const ok = fps > 45 && fps < 75 && colours > 3 && after.fits;
  if (!ok) bad++;
  console.log(
    `  ${i}. ${cab.title.padEnd(18)} ${cab.system.padEnd(3)} ${w}x${h}  ` +
      `${String(fps).padStart(2)} fps  ${String(colours).padStart(4)} colours  zoom ×${zoom}  ` +
      `shown ${drawn}:1 (frame ${shape}:1)  ${after.fits ? 'fits' : 'OFF-SCREEN'}  ${ok ? 'OK' : '<-- BAD'}`,
  );

  await p.evaluate(() => window.__arcade.leave());
  await p.waitForTimeout(500);
}

if (errs.length) console.log('\nerrors:\n  ' + [...new Set(errs)].slice(0, 4).join('\n  '));
await b.close();
process.exit(bad ? 1 : 0);
