/**
 * Stand in for the one Node API the emulator core touches.
 *
 * WHY THIS IS ITS OWN MODULE
 *   `serverboy` builds a private property key from `process.hrtime()` at module
 *   load. The first attempt at this shim sat in the body of emulator.ts, above
 *   nothing that could save it: ES module imports are hoisted and run before
 *   any statement in the importing module, so the core executed — and threw
 *   `process is not defined` — before the patch existed. The whole app rendered
 *   an empty screen, and the comment above the shim confidently explained how
 *   well it worked.
 *
 *   Imports run in declaration order, so a separate module imported ahead of
 *   serverboy genuinely runs first. That ordering is the entire point of this
 *   file, which is why it must stay the first import in emulator.ts.
 *
 * WHY A CONSTANT IS FINE
 *   The value is used to name a property, not to measure time. Nothing reads it
 *   back as a duration.
 *
 * This is the package's only use of `process`: no fs, no path, no __dirname.
 */
const g = globalThis as unknown as {
  process?: { hrtime?: () => [number, number] };
};

if (!g.process?.hrtime) {
  g.process = { ...g.process, hrtime: () => [0, 0] };
}

export {};
