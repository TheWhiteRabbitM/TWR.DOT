/**
 * The NES itself: jsnes wired to a canvas, Web Audio, and a gamepad.
 *
 * jsnes is a pure-JavaScript emulator (Apache-2.0, ~132 KB minified), which is
 * the reason this app exists at all. A WASM core would have raised the
 * cross-origin-isolation question that killed the last attempt at shipping a
 * game here — SharedArrayBuffer needs COOP/COEP headers, and our bundles are
 * served by the Polkadot app's own service worker into an iframe, so we cannot
 * set headers. No WASM, no question.
 */
import { NES, Controller } from 'jsnes';
import { Presenter } from './crt';

const WIDTH = 256;
const HEIGHT = 240;

/** How much audio to hold before the emulator waits for the sink to drain. */
const AUDIO_BUFFER = 8192;

export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';

type ButtonKey = Parameters<NES['buttonDown']>[1];

const BUTTONS: Record<Button, ButtonKey> = {
  up: Controller.BUTTON_UP,
  down: Controller.BUTTON_DOWN,
  left: Controller.BUTTON_LEFT,
  right: Controller.BUTTON_RIGHT,
  a: Controller.BUTTON_A,
  b: Controller.BUTTON_B,
  start: Controller.BUTTON_START,
  select: Controller.BUTTON_SELECT,
};

/**
 * Keyboard layout.
 *
 * Z/X for B/A is the layout every emulator has used for thirty years, and the
 * arrow keys are what a player will try first. Enter/Shift for Start/Select
 * because that is also the convention — this is not the place to be original.
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
  ShiftRight: 'select',
  ShiftLeft: 'select',
};

export class Emulator {
  private nes: NES;
  private screen: Presenter;
  private buf32: Uint32Array;
  private buf8: Uint8ClampedArray;

  private audio?: AudioContext;
  private left = new Float32Array(AUDIO_BUFFER);
  private right = new Float32Array(AUDIO_BUFFER);
  private writeIndex = 0;
  private readIndex = 0;

  private raf = 0;
  private running = false;

  /** Frames rendered since the ROM was loaded — used to prove a game booted. */
  frames = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.screen = new Presenter(canvas, WIDTH, HEIGHT);
    const buffer = new ArrayBuffer(this.screen.image.data.length);
    this.buf8 = new Uint8ClampedArray(buffer);
    this.buf32 = new Uint32Array(buffer);

    this.nes = new NES({
      onFrame: (frameBuffer: Uint32Array) => {
        for (let i = 0; i < WIDTH * HEIGHT; i++) this.buf32[i] = 0xff000000 | frameBuffer[i];
        this.screen.image.data.set(this.buf8);
        this.screen.draw();
        this.frames++;
      },
      onAudioSample: (l: number, r: number) => {
        this.left[this.writeIndex] = l;
        this.right[this.writeIndex] = r;
        this.writeIndex = (this.writeIndex + 1) % AUDIO_BUFFER;
      },
    });
  }

  /**
   * Load a ROM.
   *
   * jsnes wants a binary *string*, not a typed array — one character per byte.
   * Built in chunks because spreading a 512 KB array into String.fromCharCode
   * blows the argument limit and throws on the larger games.
   */
  async load(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch ROM: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (String.fromCharCode(...bytes.subarray(0, 3)) !== 'NES' || bytes[3] !== 0x1a)
      throw new Error('not an iNES image');

    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK)
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);

    this.frames = 0;
    this.nes.loadROM(binary);
  }

  /**
   * Run the console at the speed a console runs at.
   *
   * The first version stepped one frame per requestAnimationFrame callback,
   * with a `Math.max(1, …)` floor "so it never stalls". requestAnimationFrame
   * fires at the DISPLAY's refresh rate, so on a 120 Hz panel that floor ran
   * 120 NES frames a second and every game played at double speed — 144 Hz,
   * 2.4×. It looked correct on the 60 Hz machine it was written on, which is
   * exactly how this class of bug survives.
   *
   * The fix is a fixed-timestep accumulator: banked real time is spent one
   * whole frame at a time, so the emulation rate is a property of the console
   * and not of the monitor.
   *
   * And the console's rate is not 60. NTSC NES is 60.0988 Hz — using 60 would
   * run about 0.16% slow, which is inaudible on its own but drifts audio
   * against video over a long session.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.startAudio();

    const FRAME_MS = 1000 / 60.0988;
    /** Never emulate more than this much banked time in one callback. */
    const MAX_CATCH_UP = FRAME_MS * 4;

    let last = performance.now();
    let banked = 0;

    const loop = (now: number) => {
      if (!this.running) return;

      banked += now - last;
      last = now;

      // A hidden tab or a stalled main thread can bank minutes. Emulating all
      // of it would lock the page and fast-forward the game through whatever
      // the player was in the middle of.
      if (banked > MAX_CATCH_UP) banked = MAX_CATCH_UP;

      while (banked >= FRAME_MS) {
        this.nes.frame();
        banked -= FRAME_MS;
      }

      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.audio?.close();
    this.audio = undefined;
  }

  /**
   * Run frames synchronously, for verification only.
   *
   * The normal loop is driven by requestAnimationFrame, which browsers throttle
   * to nothing when the page is not being composited — so a headless check of
   * "does this ROM actually boot" would sit at zero frames forever and look
   * exactly like a dead game. Stepping the CPU directly separates "the emulator
   * is not running" from "the emulator ran and produced nothing".
   */
  step(count: number) {
    for (let i = 0; i < count; i++) this.nes.frame();
  }

  /**
   * How many distinct colours are on screen.
   *
   * The honest test of a boot is not that no exception was thrown — plenty of
   * ROMs load fine and render a black screen. A running game puts many colours
   * in the framebuffer; a dead one puts one or two.
   */
  colours(): number {
    const seen = new Set<number>();
    for (let i = 0; i < this.buf32.length; i += 7) seen.add(this.buf32[i] & 0xffffff);
    return seen.size;
  }

  /** The frame as the emulator drew it — see Machine.nativeCanvas. */
  nativeCanvas(): HTMLCanvasElement {
    return this.screen.nativeCanvas();
  }

  /** A cheap fingerprint of the current picture, for spotting change. */
  hash(): number {
    let h = 0;
    for (let i = 0; i < this.buf32.length; i += 3) h = ((h * 31) ^ this.buf32[i]) | 0;
    return h;
  }

  press(b: Button) {
    this.nes.buttonDown(1, BUTTONS[b]);
  }

  release(b: Button) {
    this.nes.buttonUp(1, BUTTONS[b]);
  }

  /** Map a keyboard event; returns true when the key belonged to the console. */
  key(e: KeyboardEvent, down: boolean): boolean {
    const b = KEYS[e.code];
    if (!b) return false;
    down ? this.press(b) : this.release(b);
    return true;
  }

  /**
   * Audio.
   *
   * A ScriptProcessorNode, deprecated but universally present — an AudioWorklet
   * needs a separate module file, and every extra file is one more thing that
   * can fail to resolve once the bundle is served from a content-addressed
   * store. It is created on first start because browsers refuse to open an
   * AudioContext before a user gesture.
   */
  private startAudio() {
    if (this.audio) return;
    try {
      this.audio = new AudioContext();
      const node = this.audio.createScriptProcessor(1024, 0, 2);
      node.onaudioprocess = (e) => {
        const l = e.outputBuffer.getChannelData(0);
        const r = e.outputBuffer.getChannelData(1);
        const available = (this.writeIndex - this.readIndex + AUDIO_BUFFER) % AUDIO_BUFFER;
        if (available < l.length) {
          l.fill(0);
          r.fill(0);
          return;
        }
        for (let i = 0; i < l.length; i++) {
          l[i] = this.left[this.readIndex];
          r[i] = this.right[this.readIndex];
          this.readIndex = (this.readIndex + 1) % AUDIO_BUFFER;
        }
      };
      node.connect(this.audio.destination);
    } catch {
      // No audio is a worse game, not a broken one.
    }
  }
}
