/**
 * The handheld: a Game Boy Color core wired to a canvas.
 *
 * WHY THIS CORE, AND WHY THE LAST ONE WAS WRONG
 *   The first attempt used `gameboy-emulator` — TypeScript, no dependencies,
 *   ISC, tiny. It also cannot render colour at all: no CGB identifiers, no
 *   palette registers at $FF68/$FF69, and a README describing "the 4 color
 *   palette used to draw graphics". One grep would have said so before a day of
 *   work; I checked licence and size and not the one capability the machine is
 *   named after.
 *
 *   `serverboy` wraps the GameBoy-Online core, which is a mature Game Boy Color
 *   emulator. Verified rather than assumed: booting a CGB cartridge through it
 *   produces blue, green and red in the same frame, which a DMG-only core
 *   cannot do.
 *
 * WHAT IT COSTS
 *   GPL-2.0. Linking it makes this application copyleft, so its source must be
 *   offered to anyone who receives the binary. That is satisfied by the public
 *   repository, but it is a real obligation and not a footnote.
 *
 * WHY IT IS A BETTER FIT ANYWAY
 *   It is headless — no DOM, no audio context, no loop of its own — so the
 *   frame clock is entirely ours and `doFrame()` is synchronous. Cover art and
 *   boot checks stop fighting requestAnimationFrame, which a page that is not
 *   being composited throttles to nothing.
 */
import './node-shim';
import Gameboy, { type KeyIndex } from 'serverboy';

export const WIDTH = 160;
export const HEIGHT = 144;

export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';

/** serverboy's key indices, from its own KEYMAP. */
const KEYMAP: Record<Button, KeyIndex> = {
  right: 0,
  left: 1,
  up: 2,
  down: 3,
  a: 4,
  b: 5,
  select: 6,
  start: 7,
};

/**
 * Keyboard layout — the one every emulator has used for decades.
 *
 * Z and X for B and A because that is what a returning player's hands know;
 * arrows because that is what everyone else tries first.
 */
const KEYS: Record<string, Button> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyZ: 'b',
  KeyX: 'a',
  KeyK: 'b',
  KeyL: 'a',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
};

/** The Game Boy's own rate: 4194304 / 70224 cycles. Not a round 60. */
const FRAME_MS = 1000 / 59.7275;

export class Emulator {
  private gb = new Gameboy();
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private held = new Set<Button>();
  private raf = 0;
  private running = false;

  /** Frames drawn since the cartridge went in — used to prove a game booted. */
  frames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
  }

  async load(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch ROM: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 0x150) throw new Error('too small to be a cartridge');

    this.gb = new Gameboy();
    this.gb.loadRom(bytes);
    this.held.clear();
    this.frames = 0;
  }

  /** Copy the emulator's RGBA screen onto the canvas. */
  private present() {
    const screen = this.gb.getScreen();
    this.image.data.set(screen);
    this.ctx.putImageData(this.image, 0, 0);
    this.frames++;
  }

  /**
   * Advance whole frames synchronously.
   *
   * `pressKeys` sets the buttons held *for the coming frame* rather than
   * latching them, so the held set is re-sent every frame — otherwise a
   * direction would release itself the instant the player stopped pressing
   * anything new.
   */
  step(count: number) {
    const keys = [...this.held].map((b) => KEYMAP[b]);
    for (let i = 0; i < count; i++) {
      if (keys.length) this.gb.pressKeys(keys);
      this.gb.doFrame();
      this.present();
    }
  }

  /**
   * Run at the speed the hardware runs at.
   *
   * A fixed-timestep accumulator, not one frame per animation callback. The NES
   * side shipped the latter and every game played at double speed on a 120 Hz
   * display — a bug invisible on the 60 Hz machine it was written on. Banked
   * real time is spent one whole frame at a time, so the rate belongs to the
   * console rather than to the monitor.
   */
  start() {
    if (this.running) return;
    this.running = true;

    const MAX_CATCH_UP = FRAME_MS * 4;
    let last = performance.now();
    let banked = 0;

    const loop = (now: number) => {
      if (!this.running) return;
      banked += now - last;
      last = now;
      // A hidden tab banks minutes; emulating all of it would lock the page and
      // fast-forward the player through whatever they were in the middle of.
      if (banked > MAX_CATCH_UP) banked = MAX_CATCH_UP;
      while (banked >= FRAME_MS) {
        this.step(1);
        banked -= FRAME_MS;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  press(b: Button) {
    this.held.add(b);
  }

  release(b: Button) {
    this.held.delete(b);
  }

  /** Map a key event; true when the key belonged to the handheld. */
  key(e: KeyboardEvent, down: boolean): boolean {
    const b = KEYS[e.code];
    if (!b) return false;
    down ? this.press(b) : this.release(b);
    return true;
  }

  /** How many distinct colours are on screen — a dead boot is a flat field. */
  colours(): number {
    const s = this.gb.getScreen();
    const seen = new Set<number>();
    for (let i = 0; i < s.length; i += 4 * 5) seen.add((s[i] << 16) | (s[i + 1] << 8) | s[i + 2]);
    return seen.size;
  }

  /** A cheap fingerprint of the picture, for spotting change. */
  hash(): number {
    const s = this.gb.getScreen();
    let h = 0;
    for (let i = 0; i < s.length; i += 4 * 3) h = ((h * 31) ^ s[i]) | 0;
    return h;
  }
}
