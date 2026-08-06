/**
 * icons.ts — one drawn set, at one weight.
 *
 * The first cut used whatever unicode glyph was closest: ▤ ★ ➤ ▣ 🗑. They come
 * from five different type designers, sit on five different baselines, and the
 * bin renders as a full-colour emoji on most systems, so the sidebar looked
 * like a ransom note. These are all 24×24, 1.7px stroke, same joins, same caps.
 */

const svg = (d: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const icon = {
  inbox: svg('<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5.5 6h13l1.5 7v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4z"/>'),
  star: svg('<path d="M12 4.5l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.49l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z"/>'),
  sent: svg('<path d="M20.5 3.5L11 13"/><path d="M20.5 3.5l-6.2 17-3.3-7.5L3.5 9.7z"/>'),
  archive: svg('<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10"/><path d="M10 12h4"/>'),
  trash: svg('<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M6.5 6.5l.8 12a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.8-12"/><path d="M10.5 10v6M13.5 10v6"/>'),
  key: svg('<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20"/><path d="M17 12v3M20 12v2.5"/>'),
  compose: svg('<path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  reply: svg('<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  shield: svg('<path d="M12 3.5l7 2.5v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/>'),
  /** The same shield with the tick replaced by a bar and a dot: a name that
   *  does not belong to the account that paid. Deliberately the SAME outline,
   *  so the two read as answers to one question rather than two symbols. */
  warn: svg('<path d="M12 3.5l7 2.5v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z"/><path d="M12 8.6v4.2"/><path d="M12 15.9v.1"/>'),
};

/** The mark. An envelope whose flap has not been opened, with the seal still
 *  on it — which is the one thing this app is about. Drawn so it survives
 *  being 16 pixels tall in a browser tab. */
export const logo = (size = 24) => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect x="3" y="7" width="26" height="18" rx="3" stroke="currentColor" stroke-width="2"/>
  <!-- The flap, at full strength. At .45 it vanished under 30px and the mark
       read as a camera: a rounded rectangle with a dot in the middle. The two
       diagonals are the only thing that says envelope, so they carry weight. -->
  <path d="M3.6 9.4L16 18.4 28.4 9.4" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- The seal sits over the join, punched out of the flap so it reads as wax
       laid on top rather than a hole. -->
  <circle cx="16" cy="17.6" r="4.4" fill="var(--seal-bg, #0f0f0f)"/>
  <circle cx="16" cy="17.6" r="4.4" stroke="currentColor" stroke-width="2"/>
  <circle cx="16" cy="17.6" r="1.4" fill="currentColor"/>
</svg>`;
