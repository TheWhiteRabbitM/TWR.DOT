/**
 * Lists — curated timelines, kept on the device.
 *
 * WHY NOT A CONTRACT. Every other feature added today went on chain because
 * being public is the point: a poll nobody can recount is the thing worth
 * replacing, a block rule nobody can audit is the thing worth publishing. A
 * list is the opposite. It is a note to yourself about who you want to read,
 * and putting it in public storage would broadcast an opinion about people that
 * you never offered to share — "who I think is worth following" is exactly the
 * sort of thing that reads very differently once its subject can see it.
 *
 * So a list stays here, and rides the same host-storage rescue as bookmarks and
 * mutes: every publish gives the app a new content hash and therefore a new
 * origin with empty localStorage, and `keep`/`hydrate` are what stop that
 * quietly wiping everything (see keep.ts).
 *
 * The shape is deliberately small — a name and some masks. No descriptions, no
 * sharing, no ordering. Those can be added when somebody wants them; inventing
 * them now would be storing fields nobody fills in.
 */
import { keep, recall } from './keep';

export type ChirpList = { name: string; masks: number[] };

const KEY = 'chirp.lists';
const MAX_LISTS = 20;
const MAX_NAME = 24;

/** Read them, tolerating anything a previous version or a bad write left. */
export function lists(): ChirpList[] {
  try {
    const raw = JSON.parse(recall(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && typeof l.name === 'string' && Array.isArray(l.masks))
      .map((l) => ({
        name: String(l.name).slice(0, MAX_NAME),
        masks: [...new Set((l.masks as unknown[]).map((m) => Number(m)).filter((m) => m > 0))] as number[],
      }))
      .slice(0, MAX_LISTS);
  } catch {
    return [];
  }
}

function write(all: ChirpList[]) {
  keep(KEY, JSON.stringify(all.slice(0, MAX_LISTS)));
}

/** Create a list, or return the existing one with that name. Names are unique
 *  and compared case-insensitively, because "Devs" and "devs" being two lists
 *  is a bug every time. */
export function createList(name: string): ChirpList[] {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return lists();
  const all = lists();
  if (!all.some((l) => l.name.toLowerCase() === clean.toLowerCase())) {
    all.push({ name: clean, masks: [] });
    write(all);
  }
  return lists();
}

export function removeList(name: string): ChirpList[] {
  write(lists().filter((l) => l.name.toLowerCase() !== name.toLowerCase()));
  return lists();
}

/** Put a mask in a list, or take it out. Returns whether it is now in. */
export function toggleInList(name: string, mask: number): boolean {
  const all = lists();
  const l = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!l) return false;
  const at = l.masks.indexOf(mask);
  if (at >= 0) l.masks.splice(at, 1);
  else l.masks.push(mask);
  write(all);
  return at < 0;
}

export function inList(name: string, mask: number): boolean {
  const l = lists().find((x) => x.name.toLowerCase() === name.toLowerCase());
  return Boolean(l?.masks.includes(mask));
}

/** Which lists a mask belongs to — for the "add to list" menu to show state. */
export function listsWith(mask: number): string[] {
  return lists().filter((l) => l.masks.includes(mask)).map((l) => l.name);
}
