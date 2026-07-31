/**
 * Types for `serverboy`, which ships none.
 *
 * Narrow on purpose: only the surface this app uses, so a wrong call is a
 * compile error rather than an `any` that fails at runtime. The package is
 * plain JavaScript with a stable API documented in its own docs/api.md.
 */
declare module 'serverboy' {
  /** Button indices, from the package's own KEYMAP. */
  export type KeyIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

  export default class Gameboy {
    /** Insert a cartridge. `saveData` restores battery-backed RAM. */
    loadRom(rom: Uint8Array | number[], saveData?: number[]): void;
    /** Advance one frame, synchronously. */
    doFrame(partial?: boolean): void;
    /** Buttons held for the coming frame; not latched, so re-send each frame. */
    pressKeys(keys: KeyIndex[]): void;
    /** 160x144 RGBA, 92160 bytes. */
    getScreen(): Uint8ClampedArray;
    getMemory(start?: number, end?: number): Uint8Array;
    getAudio(): number[];
    getSaveData(): number[];
  }
}
