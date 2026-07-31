/**
 * What is in each cabinet, and which machine it runs on.
 *
 * WHY THREE DIFFERENT MACHINES
 *   A real arcade was never one board repeated three times — each cabinet held
 *   whatever hardware its game needed, and part of walking down the row was that
 *   the machines were visibly different. So each cabinet here carries its own
 *   emulator: a NES, a Game Boy Color, and a slot for a third.
 *
 * WHY THE CORES ARE LOADED LAZILY
 *   Two emulators is two cores in the bundle whether or not you play. The import
 *   happens when a cabinet is chosen, so browsing the room costs neither.
 *
 * WHAT MAY GO IN A CABINET
 *   Only games we are allowed to redistribute — an explicit licence, or an
 *   author's permission — with the licence recorded here and shown on screen.
 *   An empty cabinet stays dark and says so rather than pretending.
 */

/**
 * The shape of a machine's screen.
 *
 * `w`/`h` are the framebuffer; `ar` is the shape it should be SHOWN in, and the
 * two disagree on purpose. A NES frame is 256×240 but its pixels are not square
 * — the console drew them to a 4:3 television, which is why every sprite in the
 * console's history was drawn expecting the stretch. A Game Boy's pixels are
 * square, so 160×144 is shown as 10:9. Forcing both into one box makes one of
 * them wrong, and the wrong one looks subtly cheap without ever looking broken.
 */
export type Screen = { w: number; h: number; ar: string };

/** A running machine, whichever core is behind it. */
export interface Machine {
  load(url: string): Promise<void>;
  start(): void;
  stop(): void;
  key(e: KeyboardEvent, down: boolean): boolean;
  press(b: string): void;
  release(b: string): void;
  readonly frames: number;
}

export type System = 'nes' | 'gb';

export const SCREENS: Record<System, Screen> = {
  nes: { w: 256, h: 240, ar: '4 / 3' },
  gb: { w: 160, h: 144, ar: '10 / 9' },
};

/** Build the right core for a system, importing it only when needed. */
export async function makeMachine(system: System, canvas: HTMLCanvasElement): Promise<Machine> {
  if (system === 'nes') {
    const { Emulator } = await import('./nes');
    return new Emulator(canvas) as unknown as Machine;
  }
  const { Emulator } = await import('./gb');
  return new Emulator(canvas) as unknown as Machine;
}

export type Cabinet = {
  /** Marquee text — shown whether or not a game is loaded. */
  title: string;
  system: System | null;
  /** Path under public/, or null for an empty cabinet. */
  rom: string | null;
  author?: string;
  license?: string;
  source?: string;
  /** One line under the marquee. */
  blurb?: string;
  /** What the dark screen says when the cabinet is empty. */
  note?: string;
};

/**
 * Where a cabinet's attract still lives.
 *
 * Derived from the ROM rather than stored, so the picture cannot end up
 * belonging to a game the cabinet no longer holds. `tools/posters.mjs` writes
 * them to the same name from the same rule.
 */
export const posterOf = (c: Cabinet): string | null =>
  c.rom ? `posters/${c.rom.replace(/^.*\//, '').replace(/\.[^.]+$/, '')}.png` : null;

/**
 * The row.
 *
 * Every game here was booted and played for ninety seconds before it earned a
 * cabinet — the licence says we may show it, the play test says it works.
 */
export const CABINETS: Cabinet[] = [
  {
    // The author's own name for it. It is a JezzBall-like, and calling it
    // JezzBall would be borrowing a name Microsoft still owns to describe
    // somebody else's game.
    title: 'JEZNES',
    system: 'nes',
    rom: 'roms/jezzball.nes',
    author: 'boingoing',
    license: 'MIT',
    source: 'https://github.com/boingoing/jeznes',
    blurb: 'Fence off the bouncing balls. Nintendo Entertainment System.',
  },
  {
    title: 'TOBU TOBU GIRL',
    system: 'gb',
    rom: 'roms/tobutobugirldeluxe.gbc',
    author: 'Tangram Games',
    license: 'MIT + CC BY 4.0',
    source: 'https://github.com/SimonLarsen/tobutobugirl-dx',
    blurb: 'An arcade platformer. Game Boy Color.',
  },
  {
    title: 'GEOMETRIX',
    system: 'gb',
    rom: 'roms/geometrix.gbc',
    author: 'AntonioND',
    license: 'GPL-3.0-or-later',
    source: 'https://github.com/AntonioND/geometrix',
    blurb: 'Shapes, patterns, quick decisions. Game Boy Color.',
  },
];
