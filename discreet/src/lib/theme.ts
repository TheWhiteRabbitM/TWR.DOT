/**
 * Visual identity per category — a calm but RICH gradient family, so the list
 * reads as a place you'd want to be, not a settings screen. One gradient per
 * category, used on card banners and the detail hero.
 */
const GRADIENTS: Record<string, string> = {
  Wellbeing: 'linear-gradient(135deg,#0d9488 0%,#065f56 60%,#134e4a 100%)',
  Health: 'linear-gradient(135deg,#0284c7 0%,#075985 60%,#0c4a6e 100%)',
  'Legal & money': 'linear-gradient(135deg,#6366f1 0%,#4338ca 60%,#312e81 100%)',
  Classes: 'linear-gradient(135deg,#d97706 0%,#b45309 60%,#78350f 100%)',
  Beauty: 'linear-gradient(135deg,#db2777 0%,#9d174d 60%,#831843 100%)',
};

const FALLBACK = 'linear-gradient(135deg,#475569 0%,#334155 60%,#1e293b 100%)';

export function categoryGradient(category: string): string {
  return GRADIENTS[category] ?? FALLBACK;
}

/** A flat accent drawn from the same family (state dots, small highlights). */
const ACCENTS: Record<string, string> = {
  Wellbeing: '#14b8a6',
  Health: '#38bdf8',
  'Legal & money': '#818cf8',
  Classes: '#fbbf24',
  Beauty: '#f472b6',
};

export function categoryAccent(category: string): string {
  return ACCENTS[category] ?? '#94a3b8';
}
