/**
 * The pictures the store and dotmetrics show for this app.
 *
 * WHY THESE ARE NOT THE VERIFICATION SHOTS
 *   `look.mjs` screenshots whatever is on screen when its checks finish, which
 *   is often a title card or a menu — correct for proving the thing boots, wrong
 *   for a shop window. These are taken deliberately: the room first, because
 *   that is what the app IS, then a cabinet walked all the way into play.
 *
 *   Same reason the blink is frozen bright: a store card that catches PRESS
 *   START on its dark half looks like a bug.
 *
 *   node tools/store-shots.mjs http://localhost:5185
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5185';
mkdirSync('store', { recursive: true });

const hold = (p, code, ms = 220) =>
  p.keyboard
    .down(code)
    .then(() => p.waitForTimeout(ms))
    .then(() => p.keyboard.up(code));

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

/*
 * JPEG, not PNG.
 *
 * These go on Bulletin, where our own account's quota is what pays for them —
 * and a lossless 2560x1600 screenshot of a dark room with a glowing screen in
 * it is 1.3 MB of mostly gradient. At quality 88 the same picture is under a
 * tenth of that and the difference is invisible on a store card.
 */
const shoot = (path) => p.screenshot({ path, type: 'jpeg', quality: 88 });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.poster');

// Skip the shutter. Clicking to skip it would be a click the room has to not
// misread as choosing a cabinet, and four seconds per run adds up.
await p.evaluate(() => window.__arcade.openNow());
await p.waitForTimeout(1200); // let the posters decode, or the room shot has holes

await p.addStyleTag({ content: '.idle { animation: none !important; opacity: 1 !important }' });
await shoot('store/1-room.jpg');
console.log('  1-room.jpg            the row, attract stills lit');

/** Is the picture changing? A paused game and a menu are both perfectly still. */
const moving = (i) =>
  p.evaluate(async (i) => {
    const c = document.querySelector(`[data-screen="${i}"]`);
    const ctx = c.getContext('2d');
    const a = ctx.getImageData(0, 0, c.width, c.height).data;
    await new Promise((r) => setTimeout(r, 250));
    const b = ctx.getImageData(0, 0, c.width, c.height).data;
    let changed = 0;
    for (let j = 0; j < a.length; j += 4) if (a[j] !== b[j]) changed++;
    return changed > (a.length / 4) * 0.002;
  }, i);

/** Walk a cabinet in far enough that the shot shows the game, not its titles. */
async function play(i, file, note) {
  await p.evaluate((i) => window.__arcade.walkUp(i), i);
  await p.waitForTimeout(3500);
  for (let n = 0; n < 26; n++) {
    const k = ['Enter', 'KeyX', 'KeyZ', null][n % 4];
    if (k) await hold(p, k);
    await p.waitForTimeout(600);
  }

  // The walk presses START, and START pauses a game that has already begun —
  // which is how the first Jeznes card came out with PAUSE! across it. Press it
  // once more and check, rather than assuming either state.
  for (let n = 0; n < 8 && !(await moving(i)); n++) {
    await hold(p, 'Enter');
    await p.waitForTimeout(700);
  }

  await shoot(file);
  console.log(`  ${file.replace('store/', '').padEnd(22)}${note}`);
  await p.evaluate(() => window.__arcade.leave());
  await p.waitForTimeout(500);
}

await play(0, 'store/2-jeznes.jpg', 'walked up to the NES cabinet, mid-game');
await play(2, 'store/3-geometrix.jpg', 'walked up to a Game Boy Color cabinet');

await b.close();
