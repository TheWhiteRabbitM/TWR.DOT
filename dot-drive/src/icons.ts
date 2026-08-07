/**
 * icons.ts — one drawn set, at one weight. 24×24, 1.7px stroke, same joins.
 *
 * Every SVG carries a viewBox and no width, which means an unsized one in a
 * flex row expands to fill the row. The stylesheet gives them a text-sized
 * default and the two places that want to be big say so. That exact omission
 * blew a 19px icon up to the full width of a card in peoplebook.
 */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icon = {
  upload: svg('<path d="M12 16V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15"/>'),
  download: svg('<path d="M12 4v12"/><path d="M7.5 11.5L12 16l4.5-4.5"/><path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15"/>'),
  file: svg('<path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5"/>'),
  send: svg('<path d="M20.5 3.5L11 13"/><path d="M20.5 3.5l-6.2 17-3.3-7.5L3.5 9.7z"/>'),
  trash: svg('<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M6.5 6.5l.8 12a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.8-12"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="9" rx="1.6"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="1.6"/><path d="M15 6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16"/>'),
  warn: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v4.4"/><path d="M12 15.7v.1"/>'),
};

/**
 * The mark. A sealed box: a parcel with a band across it, because that is what
 * a file here is. Drawn so it survives being 16 pixels tall in a browser tab.
 */
export const logo = (size = 26) => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M4 10.5L16 4l12 6.5v11L16 28 4 21.5z" stroke="currentColor" stroke-width="1.9"
        stroke-linejoin="round"/>
  <path d="M4 10.5L16 17l12-6.5M16 17v11" stroke="currentColor" stroke-width="1.9"
        stroke-linejoin="round"/>
  <circle cx="16" cy="13.4" r="2.4" fill="currentColor"/>
</svg>`;
