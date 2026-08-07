/**
 * store.ts — where envelopes live, behind one interface with two backings.
 *
 * `LocalStore` keeps them in this browser so the app can be built and shown
 * before anything is deployed. A contract-backed store will implement the same
 * interface. They are NOT interchangeable in what they mean, only in what they
 * do, and every screen says which one answered.
 *
 * A store never decrypts. It moves opaque bytes and cannot tell a letter from
 * a photograph of a wall.
 */
import { hex, unhex } from './keys.ts';
import { SLOTS } from './seal.ts';

/**
 * DotMail on Asset Hub. Deployed and exercised end to end: a sealed letter
 * written and read back word for word, and a three-part attachment landing in
 * three consecutive writes.
 *
 * Measured on the way through, because these are the numbers a ContractStore
 * has to live with: a send settles in about 2.3 s, and `heads()` answers in
 * roughly 120 ms whether it is asked for 1 row or 200 — the round trip is the
 * cost, not the payload, which is exactly the shape that makes paging work.
 */
export const DOTMAIL = '0x9e12df714fd4b581414753d07fee23e00f7e2bf3';

export type Head = { id: number; tags: Uint8Array[]; eph: Uint8Array };
export type Body = { id: number; sealed: Uint8Array; from: string; time: number };

export interface MailStore {
  readonly kind: 'chain' | 'local';
  readonly where: string;
  /** `null` means the store could not be asked, which is never an empty inbox. */
  count(): Promise<number | null>;
  heads(start: number, n: number): Promise<Head[] | null>;
  bodies(ids: number[]): Promise<Body[] | null>;
  setKey(pub: Uint8Array): Promise<{ ok: boolean; why?: string }>;
  /** `null` = could not ask. `undefined` = asked, they have no mailbox. */
  keyOf(who: string): Promise<Uint8Array | null | undefined>;
  send(tags: Uint8Array[], eph: Uint8Array, sealed: Uint8Array): Promise<{ ok: boolean; why?: string }>;
  me(): Promise<string | null>;
}

const LKEY = 'dotmail.local.envelopes';
const LKEYS = 'dotmail.local.keys';
const LME = 'dotmail.local.me';

type Stored = { tags: string[]; eph: string; sealed: string; from: string; time: number };

export class LocalStore implements MailStore {
  readonly kind = 'local' as const;
  readonly where = 'this browser only';

  private read(): Stored[] {
    try { return JSON.parse(localStorage.getItem(LKEY) ?? '[]') as Stored[]; } catch { return []; }
  }
  private write(all: Stored[]) { localStorage.setItem(LKEY, JSON.stringify(all)); }
  private keys(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(LKEYS) ?? '{}') as Record<string, string>; } catch { return {}; }
  }

  async me() {
    let id = localStorage.getItem(LME);
    if (!id) { id = 'you'; localStorage.setItem(LME, id); }
    return id;
  }

  async count() { return this.read().length; }

  async heads(start: number, n: number) {
    return this.read().slice(start, start + n).map((e, i) => ({
      id: start + i,
      tags: e.tags.slice(0, SLOTS).map(unhex),
      eph: unhex(e.eph),
    }));
  }

  async bodies(ids: number[]) {
    const all = this.read();
    return ids.filter((i) => all[i]).map((i) => ({
      id: i, sealed: unhex(all[i].sealed), from: all[i].from, time: all[i].time,
    }));
  }

  async setKey(pub: Uint8Array) {
    const k = this.keys();
    k[(await this.me()) ?? 'you'] = hex(pub);
    localStorage.setItem(LKEYS, JSON.stringify(k));
    return { ok: true };
  }

  async keyOf(who: string) {
    const v = this.keys()[who];
    return v ? unhex(v) : undefined;
  }

  async send(tags: Uint8Array[], eph: Uint8Array, sealed: Uint8Array) {
    const all = this.read();
    all.push({
      tags: tags.map(hex), eph: hex(eph), sealed: hex(sealed),
      from: (await this.me()) ?? 'you', time: Math.floor(Date.now() / 1000),
    });
    this.write(all);
    return { ok: true };
  }

  async addContact(handle: string, pub: Uint8Array) {
    const k = this.keys();
    k[handle] = hex(pub);
    localStorage.setItem(LKEYS, JSON.stringify(k));
  }

  async contacts(): Promise<{ name: string; key: string }[]> {
    return Object.entries(this.keys()).map(([name, key]) => ({ name, key }));
  }
}

/* -------------------------------------------------------------- local flags
 *
 * Read, starred, archived, trashed. All of it lives here and nowhere else, and
 * the interface says so, because none of it CAN go on chain without undoing
 * the privacy: a public "read" flag tells an observer when you opened a letter
 * they already could not read, which is a surprising amount to give away.
 *
 * Deleting deserves the same honesty. Trash hides a letter from you; the
 * envelope stays on the chain forever, because that is what a chain is. Any
 * mail client that offers a delete button which quietly does not delete is
 * lying, so this one says it on the button.
 */
const FLAGS = 'dotmail.flags';
export type Flag = 'read' | 'star' | 'archive' | 'trash';

type FlagMap = Record<string, Flag[]>;

const readFlags = (): FlagMap => {
  try { return JSON.parse(localStorage.getItem(FLAGS) ?? '{}') as FlagMap; } catch { return {}; }
};

export const flagsOf = (id: number): Flag[] => readFlags()[String(id)] ?? [];
export const hasFlag = (id: number, f: Flag) => flagsOf(id).includes(f);

export function setFlag(id: number, f: Flag, on: boolean) {
  const all = readFlags();
  const cur = new Set(all[String(id)] ?? []);
  if (on) cur.add(f); else cur.delete(f);
  all[String(id)] = [...cur];
  localStorage.setItem(FLAGS, JSON.stringify(all));
}
