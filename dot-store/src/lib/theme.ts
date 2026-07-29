import { useEffect, useState } from 'react';

/**
 * Appearance, the way Apple does it: three choices, and Auto is the default.
 *
 * The choice is written to `data-theme` on <html> so CSS can override the
 * `prefers-color-scheme` default in BOTH directions — a viewer whose system is
 * dark can still pick Light. Auto removes the attribute and hands control back
 * to the system. `index.html` applies the stored value before first paint, so
 * choosing Light on a dark system does not flash black.
 */
export const MODES = ['auto', 'light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

const KEY = 'dotstore.theme';

function read(): Mode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (MODES as readonly string[]).includes(saved)) return saved as Mode;
  } catch {
    /* private mode */
  }
  return 'auto';
}

let current: Mode = read();
const listeners = new Set<(m: Mode) => void>();

/** Paint the choice. Also keeps the browser UI (form controls, scrollbars) in step. */
function apply(m: Mode): void {
  const root = document.documentElement;
  if (m === 'auto') {
    delete root.dataset.theme;
    root.style.colorScheme = 'light dark';
  } else {
    root.dataset.theme = m;
    root.style.colorScheme = m;
  }
}

export function getMode(): Mode {
  return current;
}

export function setMode(m: Mode): void {
  current = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* ignore */
  }
  apply(m);
  listeners.forEach((fn) => fn(m));
}

export function useMode(): Mode {
  const [m, setM] = useState(current);
  useEffect(() => {
    listeners.add(setM);
    return () => {
      listeners.delete(setM);
    };
  }, []);
  return m;
}

/** Called once at start-up: re-assert the stored choice React-side. */
export function initTheme(): void {
  apply(current);
}
