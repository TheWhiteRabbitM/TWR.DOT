/**
 * Turning a finding into an edit.
 *
 * The detector reports what is wrong and often what to write instead, but its
 * suggestions come in two kinds and only one of them can be applied by a
 * machine. "leverage -> use" is a swap. "vibrant -> describe what makes it
 * active" is an instruction to a writer, and a tool that silently pasted that
 * sentence into someone's text would be worse than useless.
 *
 * So each finding is sorted into an edit or a note, and the notes are shown as
 * advice rather than offered as a button.
 */
import type { Issue } from './detector.js';

/** Suggestions that open with one of these are addressed to a person. */
const INSTRUCTION = [
  'describe', 'name ', 'name the', 'cut', 'state', 'replace', 'use the', 'pick',
  'say ', 'drop', 'write', 'explain', 'give', 'rewrite', 'convert', 'break',
  'list ', 'delete', 'strip', 'fill', 'open on', 'lead with', 'add ', 'reposition',
  'let ', 'preserve', 'keep ', 'prefer', 'consider', 'remove',
];

const WORDISH = new Set(['tier1', 'tier2', 'tier3', 'tier1_phrase', 'tier3_phrase', 'filler', 'filler-phrase']);

export interface Edit {
  issue: Issue;
  from: string;
  to: string;
  /** how many times it occurs in the current text */
  count: number;
}

const firstAlternative = (s: string) => s.split(/[,;]|\bor\b/)[0].trim();

const isInstruction = (s: string) => {
  const low = s.trim().toLowerCase();
  return INSTRUCTION.some((p) => low.startsWith(p)) || low.split(/\s+/).length > 5;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A word-boundary matcher that also works for multi-word phrases. */
export function occurrences(text: string, phrase: string): number {
  const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, 'gi');
  return (text.match(re) ?? []).length;
}

/** Keep the replacement in the case of what it replaces: Robust -> Strong. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}


/**
 * Swapping a word can break the article in front of it: "a pivotal moment"
 * becomes "a important moment". Only the article immediately before a word we
 * just changed is touched, and the usual liars are listed, because "an user"
 * and "a hour" are worse than the problem being fixed.
 */
const SOUNDS_CONSONANT = /^(user|users|unique|uniform|unified|union|useful|usual|european|one|once)/i;
const SOUNDS_VOWEL = /^(hour|honest|honou?r|heir)/i;

function fixArticle(text: string, word: string): string {
  const vowelish = /^[aeiou]/i.test(word) ? !SOUNDS_CONSONANT.test(word) : SOUNDS_VOWEL.test(word);
  const re = new RegExp(`\\b(a|an|A|An)\\s+(${escapeRe(word)})\\b`, 'g');
  return text.replace(re, (_m, art: string, w: string) => {
    const upper = art[0] === art[0].toUpperCase();
    const want = vowelish ? 'an' : 'a';
    return `${upper ? want[0].toUpperCase() + want.slice(1) : want} ${w}`;
  });
}
export function applyEdit(text: string, edit: Edit): string {
  const re = new RegExp(`\\b${escapeRe(edit.from)}\\b`, 'gi');
  const swapped = text.replace(re, (m) => matchCase(m, edit.to));
  return fixArticle(swapped, edit.to);
}

/** The findings that can be fixed by swapping words, deduplicated. */
export function editsFor(text: string, issues: Issue[]): Edit[] {
  const seen = new Set<string>();
  const out: Edit[] = [];
  for (const issue of issues) {
    if (!WORDISH.has(issue.type)) continue;
    if (!issue.suggestion || isInstruction(issue.suggestion)) continue;
    const from = issue.text.trim();
    const to = firstAlternative(issue.suggestion);
    if (!from || !to || to.toLowerCase() === from.toLowerCase()) continue;
    const key = from.toLowerCase();
    if (seen.has(key)) continue;
    const count = occurrences(text, from);
    if (count === 0) continue;
    seen.add(key);
    out.push({ issue, from, to, count });
  }
  return out;
}

/** Findings that need a person: shown as advice, never applied automatically. */
export function notesFor(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    if (WORDISH.has(i.type) && i.suggestion && !isInstruction(i.suggestion)) return false;
    const key = `${i.type}:${i.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------- structural rewrites ---- */

export interface Rewrite {
  id: string;
  label: string;
  detail: string;
  run: (t: string) => string;
  applies: (t: string) => boolean;
}

export const REWRITES: Rewrite[] = [
  {
    id: 'emdash',
    label: 'Em dashes to commas',
    detail: 'An em dash every other sentence is one of the loudest tells. Most of them are commas.',
    applies: (t) => /\s—\s|—/.test(t),
    run: (t) => t.replace(/\s*—\s*/g, ', ').replace(/,\s*,/g, ','),
  },
  {
    id: 'curly',
    label: 'Curly quotes to straight',
    detail: 'Typed text carries straight quotes. Curly ones arrive from a generator or a word processor.',
    applies: (t) => /[\u2018\u2019\u201C\u201D]/.test(t),
    run: (t) => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'),
  },
  {
    id: 'opener',
    label: 'Drop the chatbot opener',
    detail: 'Certainly, Sure, I hope this helps: nobody writing for themselves starts like that.',
    applies: (t) => /^\s*(certainly|sure|absolutely|great question|of course)[!,.]/i.test(t),
    run: (t) => t.replace(/^\s*(certainly|sure|absolutely|great question|of course)[!,.]\s*/i, ''),
  },
  {
    id: 'conclusion',
    label: 'Cut the formulaic closer',
    detail: 'In conclusion, the future looks bright, only time will tell. Say the specific thing or stop.',
    applies: (t) => /\b(in conclusion|the future looks bright|only time will tell)\b/i.test(t),
    run: (t) =>
      t
        .replace(/\s*\bIn conclusion,?\s*/gi, ' ')
        .replace(/[^.!?]*\b(the future looks bright|only time will tell)\b[^.!?]*[.!?]\s*/gi, '')
        .trim(),
  },
  {
    id: 'transitions',
    label: 'Thin the transitions',
    detail: 'Moreover, Furthermore, Additionally. One paragraph rarely needs any of them.',
    applies: (t) => /\b(moreover|furthermore|additionally)\b/i.test(t),
    run: (t) => t.replace(/\b(Moreover|Furthermore|Additionally),?\s*/g, '').replace(/\b(moreover|furthermore|additionally),?\s*/g, ''),
  },
];
