/**
 * Capture one still per cabinet, from the game itself.
 *
 * WHY THE ROOM NEEDS THESE
 *   Three black rectangles is not an arcade. A real one was lit by the games:
 *   you knew what was in a cabinet from across the room, before you read the
 *   marquee. So each cabinet shows a frame of its own game behind the PRESS
 *   START, and the moment you walk up the live emulator takes over the same box.
 *
 * WHY THEY ARE CAPTURED AND NOT DRAWN
 *   A hand-made poster is a promise about a game. A frame lifted out of the
 *   running ROM is the game. It also cannot drift: re-run this after swapping a
 *   cartridge and the picture follows.
 *
 * WHY NOT JUST RUN THREE EMULATORS IN THE ROOM
 *   serverboy keeps its memory and input as module singletons, so two Game Boy
 *   cabinets running at once corrupt each other — the same fault that stopped
 *   gameboyonchain from animating its covers. A still costs nothing and lies
 *   about nothing.
 *
 *   Run against the dev server:  node tools/posters.mjs http://localhost:5185
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

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
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:5185';
const OUT = join(process.cwd(), 'public', 'posters');
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.cab');

// Skip the shutter. Clicking to skip it would be a click the room has to not
// misread as choosing a cabinet, and four seconds per run adds up.
await p.evaluate(() => window.__arcade.openNow());
await p.waitForTimeout(600);

const cabinets = await p.evaluate(() => window.__arcade.cabinets);

/**
 * What is on the screen, and whether it is alive.
 *
 * Read from the emulator's own frame rather than the glass — a poster of the
 * scanlines and the bloom would be a picture of this app, not of the game, and
 * it would be three times the size for it.
 *
 * `colours` says there is a picture at all. `moving` says the game is running
 * rather than sitting on a menu, a title card or — the one that produced a
 * genuinely bad poster — its own PAUSE screen, which the walk had triggered by
 * pressing START during play.
 */
const sample = async () => ({
  ...(await p.evaluate(() => window.__arcade.look())),
  png: await p.evaluate(() => window.__arcade.frame()),
});

for (let i = 0; i < cabinets.length; i++) {
  const cab = cabinets[i];
  if (!cab.rom) continue;
  const id = cab.rom.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

  await p.evaluate((i) => window.__arcade.walkUp(i), i);

  // Long enough for the core chunk, the ROM fetch, the boot, AND the publisher
  // splash. Grabbing at 1.6s gave Tobu Tobu Girl a poster of its publisher's
  // logo — a correct capture of the wrong screen.
  await p.waitForTimeout(3500);

  // Walk it past the intro.
  //
  // Long, and stubborn about it. Tobu Tobu Girl DX opens with a publisher card,
  // a sound credit and an animated title; the first two ignore input for their
  // whole run, so twenty steps of pressing ended on the sound credit and the
  // best poster this could produce was somebody else's logo. Forty steps of
  // roughly a second each gets past it. Games also disagree about which button
  // is START, so all the plausible ones get a turn, and a plain wait every
  // fourth step lets a timed card expire on its own.
  const shots = [];
  const BUTTONS = ['Enter', 'KeyX', 'KeyZ', null];
  const script = Array.from({ length: 40 }, (_, n) => BUTTONS[n % 4]);
  for (const k of script) {
    if (k) await hold(p, k, 220);
    await p.waitForTimeout(700);
    shots.push(await sample());
  }

  // Take the last frame that is BOTH rich and moving.
  //
  // Richest alone picked Tobu Tobu Girl's sound-credits card — genuinely the
  // most colourful thing in its four-screen intro, and not the game. Latest
  // alone picked Jeznes mid-play with PAUSE! across it, because the walk keeps
  // pressing START. Later is better, so the search runs backwards; the floor
  // rejects the black a game fades through between scenes, and `moving` rejects
  // every screen the game is stopped on.
  const floor = Math.max(...shots.map((s) => s.colours)) * 0.6;
  const back = [...shots].reverse();
  const pick =
    back.find((s) => s.colours >= floor && s.moving) ??
    back.find((s) => s.colours >= floor) ??
    shots[shots.length - 1];

  writeFileSync(join(OUT, `${id}.png`), Buffer.from(pick.png.split(',')[1], 'base64'));
  console.log(
    `  ${id.padEnd(24)} ${String(pick.colours).padStart(4)} colours  ${pick.moving ? 'moving' : 'static'}  ` +
      `(${shots.filter((s) => s.moving).length} of ${shots.length} frames were live)`,
  );

  await p.evaluate(() => window.__arcade.leave());
  await p.waitForTimeout(400);
}

await b.close();
