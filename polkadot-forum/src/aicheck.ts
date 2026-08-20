/**
 * Reading a post's writing, on request.
 *
 * Two rules shaped this, and both are about restraint.
 *
 * It never runs on its own. Stamping a verdict on every post — above all on the
 * imported ones, written by named people who never agreed to be scored — would
 * turn a reading tool into an accusation machine. So nothing is measured until
 * a reader asks about one specific post.
 *
 * And it never claims to know. The detector finds patterns that cluster in
 * generated prose; it cannot tell you who typed something. A high score on a
 * 2022 post means that person wrote in a way a model later learned to imitate,
 * which is a fact about the model, not about them.
 *
 * The engine is 112 KB, so it is imported lazily. A reader who never asks for a
 * check never downloads it.
 */
import type { Result } from './detector.js';

export type { Result };

let engine: Promise<{ analyzeText: (t: string, o?: { contextMode?: 'general' | 'technical' }) => Result }> | null = null;
function load() {
  engine ??= import('./detector.js').then((m) => m.default ?? m);
  return engine;
}

/** Plain text out of the imported `cooked` HTML: quotes, code and links carry
 *  other people's words, so they are dropped before anything is counted. */
export function textOf(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const el of tpl.content.querySelectorAll('blockquote, pre, code, aside, .quote')) el.remove();
  return (tpl.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const cache = new Map<string, Result | null>();

/** Below this there is nothing to read: the engine itself refuses short text. */
export const MIN_CHARS = 220;

export async function check(key: string, text: string): Promise<Result | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  if (text.trim().length < MIN_CHARS) {
    cache.set(key, null);
    return null;
  }
  try {
    const { analyzeText } = await load();
    const r = analyzeText(text, { contextMode: 'general' });
    cache.set(key, r);
    return r;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/** Was this written before the tools existed? ChatGPT opened on 30 Nov 2022. */
export function predatesLLMs(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < Date.parse('2022-11-30T00:00:00Z');
}

export const band = (score: number): 'cool' | 'warm' | 'hot' =>
  score >= 60 ? 'hot' : score >= 25 ? 'warm' : 'cool';
