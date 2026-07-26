/**
 * Terminal sound: tiny square-wave beeps from WebAudio, no assets.
 *
 * The context is created lazily on the first call, which always happens inside
 * a click/keydown handler, so autoplay policy is satisfied. Everything is
 * wrapped in try/catch — sound is garnish, and a locked-down browser must
 * degrade to silence, never to a crash.
 */

let ctx: AudioContext | null = null;

function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'square',
  gain = 0.035,
  delay = 0,
): void {
  try {
    const c = ensure();
    if (!c) return;

    const osc = c.createOscillator();
    const vol = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    const t = c.currentTime + delay;
    vol.gain.setValueAtTime(gain, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(vol).connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch {
    // Silence is an acceptable fallback.
  }
}

export const sfx = {
  /** Keypad click. */
  key(): void {
    tone(760, 0.05);
  },
  /** EXECUTE going down. */
  execute(): void {
    tone(196, 0.18, 'sawtooth', 0.05);
  },
  /** Press confirmed on chain. */
  logged(): void {
    tone(523, 0.09);
    tone(659, 0.09, 'square', 0.035, 0.1);
    tone(784, 0.14, 'square', 0.035, 0.2);
  },
  /** Something soft and white just crossed the floor. */
  rabbit(): void {
    [880, 988, 1175, 1319].forEach((f, i) => tone(f, 0.08, 'triangle', 0.045, i * 0.09));
  },
  /** The chain said no. */
  fault(): void {
    tone(140, 0.25, 'sawtooth', 0.045);
  },
};
