/**
 * store.ts — where envelopes live, behind one interface with two backings.
 *
 * WHY TWO
 *   `ContractStore` is the real thing: the DotMail contract on Asset Hub.
 *   `LocalStore` keeps the same envelopes in this browser so the app can be
 *   built, exercised and demonstrated before anything is deployed.
 *
 *   They are NOT interchangeable in what they mean, only in what they do, and
 *   the interface says which one is answering. Every screen shows it. This app
 *   spent a whole day next door learning what happens when software reports a
 *   success it did not achieve, and "your mail is on chain" is a worse thing to
 *   be wrong about than most.
 *
 * WHAT A STORE NEVER DOES
 *   Decrypt. It moves opaque bytes. All of the meaning is in seal.ts, and the
 *   store cannot tell a letter from a photograph of a wall.
 */
import { hex, unhex } from './keys.ts';

export type Head = { id: number; tag: Uint8Array; eph: Uint8Array };
export type Body = { id: number; sealed: Uint8Array; from: string; time: number };

export interface MailStore {
  /** `chain` or `local`, for the interface to state plainly. */
  readonly kind: 'chain' | 'local';
  /** Where this store can be reached, for the diagnostics screen. */
  readonly where: string;
  /** Total envelopes. `null` means the store could not be asked, which is not
   *  the same as zero and must never be rendered as an empty inbox. */
  count(): Promise<number | null>;
  /** Tags and ephemeral keys, cheap, in pages. */
  heads(start: number, n: number): Promise<Head[] | null>;
  /** Full envelopes, only for ids whose tag already matched. */
  bodies(ids: number[]): Promise<Body[] | null>;
  /** Publish a recipient key so people can write to you. */
  setKey(pub: Uint8Array): Promise<{ ok: boolean; why?: string }>;
  /** Look up somebody's published key. `null` = could not ask; `undefined` =
   *  asked, and they have not published one. The distinction decides whether
   *  the composer says "try again" or "they have no mailbox yet". */
  keyOf(who: string): Promise<Uint8Array | null | undefined>;
  send(tag: Uint8Array, eph: Uint8Array, sealed: Uint8Array): Promise<{ ok: boolean; why?: string }>;
  /** Who this store thinks we are, for display. */
  me(): Promise<string | null>;
}

/* ------------------------------------------------------------------ local */

const LKEY = 'dotmail.local.envelopes';
const LKEYS = 'dotmail.local.keys';
const LME = 'dotmail.local.me';

type StoredEnvelope = { tag: string; eph: string; sealed: string; from: string; time: number };

/**
 * The whole mailbox in this browser.
 *
 * Deliberately the same shape the contract exposes — pages of heads, bodies by
 * id — so that switching to the chain changes one line and not the app. If the
 * local store had a convenient extra method, the real one would be missing it
 * exactly when it mattered.
 */
export class LocalStore implements MailStore {
  readonly kind = 'local' as const;
  readonly where = 'this browser only';

  private read(): StoredEnvelope[] {
    try { return JSON.parse(localStorage.getItem(LKEY) ?? '[]') as StoredEnvelope[]; } catch { return []; }
  }
  private write(all: StoredEnvelope[]) { localStorage.setItem(LKEY, JSON.stringify(all)); }
  private keys(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(LKEYS) ?? '{}') as Record<string, string>; } catch { return {}; }
  }

  async me() {
    let id = localStorage.getItem(LME);
    if (!id) { id = 'local:' + Math.random().toString(36).slice(2, 10); localStorage.setItem(LME, id); }
    return id;
  }

  async count() { return this.read().length; }

  async heads(start: number, n: number) {
    return this.read().slice(start, start + n).map((e, i) => ({
      id: start + i, tag: unhex(e.tag), eph: unhex(e.eph),
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
    k[await this.me() ?? 'me'] = hex(pub);
    localStorage.setItem(LKEYS, JSON.stringify(k));
    return { ok: true };
  }

  async keyOf(who: string) {
    const v = this.keys()[who];
    return v ? unhex(v) : undefined;             // asked, and there is none
  }

  async send(tag: Uint8Array, eph: Uint8Array, sealed: Uint8Array) {
    const all = this.read();
    all.push({
      tag: hex(tag), eph: hex(eph), sealed: hex(sealed),
      from: (await this.me()) ?? 'local', time: Math.floor(Date.now() / 1000),
    });
    this.write(all);
    return { ok: true };
  }

  /** Local only: publish a key under an arbitrary handle, so one browser can
   *  play both correspondents while the app is being built. */
  async addContact(handle: string, pub: Uint8Array) {
    const k = this.keys();
    k[handle] = hex(pub);
    localStorage.setItem(LKEYS, JSON.stringify(k));
  }

  async contacts(): Promise<string[]> {
    return Object.keys(this.keys());
  }
}
