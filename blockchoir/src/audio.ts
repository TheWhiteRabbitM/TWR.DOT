/**
 * The instrument.
 *
 * Everything here follows from one decision: the scale is pentatonic and fixed.
 * A major pentatonic has no semitone clashes in it, so any set of notes anyone
 * chooses sounds consonant against any other. Strangers cannot write something
 * ugly together, which means nobody has to be in charge of the music. It is the
 * argument this ecosystem makes about speech, made somewhere it can be
 * demonstrated in four seconds instead of argued about.
 *
 * Synthesis is deliberately small: a triangle for the body, a sine an octave up
 * for air, a short decay, one delay line. It has to run in a sandboxed iframe on
 * a phone, and a plucked string costing two oscillators carries a crowd better
 * than a sample library nobody can load.
 */

/** Major pentatonic, the degrees that cannot clash. */
const SCALE = [0, 2, 4, 7, 9];
export const VOICES = 16;

/** Midi note for a row of the score, counting up from the bottom. */
export function noteOf(row: number): number {
  const step = VOICES - 1 - row;
  const octave = Math.floor(step / SCALE.length);
  return 48 + octave * 12 + SCALE[step % SCALE.length];
}
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Choir {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private delay: DelayNode | null = null;

  /** Built on the first gesture, because a browser will not start audio without one. */
  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);

    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(out);

    this.ctx = ctx;
    this.out = out;
    this.delay = delay;
    return ctx;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  get currentTime(): number {
    return this.ensure().currentTime;
  }

  /**
   * Pluck one note. `strength` is the stored nibble, 1 to 15: it opens the
   * filter and lifts the level, so a cell carries how hard it was struck as well
   * as whether it sounds.
   */
  pluck(midi: number, strength: number, at?: number) {
    const ctx = this.ensure();
    if (!this.out || !this.delay) return;
    const t = at ?? ctx.currentTime;
    const v = Math.min(1, 0.2 + (strength / 15) * 0.8);
    const f = hz(midi);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 + v * 0.8);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 + v * 4200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.9);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = f;
    const air = ctx.createOscillator();
    air.type = 'sine';
    air.frequency.value = f * 2;
    const airG = ctx.createGain();
    airG.gain.value = 0.22 * v;

    body.connect(lp);
    air.connect(airG);
    airG.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.delay);

    body.start(t);
    air.start(t);
    body.stop(t + 2.2);
    air.stop(t + 2.2);
  }
}
