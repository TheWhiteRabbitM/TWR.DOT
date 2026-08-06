/**
 * chainstore.ts — the same MailStore, backed by DotMail on Asset Hub.
 *
 * Every awkward line here is a lesson from the app next door, and each one is
 * marked, because they all look like over-engineering until the day they do
 * not:
 *
 *   - A REFUSED READ IS NOT AN EMPTY ANSWER. Reads return `null` for "could
 *     not ask" and never zero. An inbox that shows nothing because the node
 *     hiccuped is the worst failure this app has available.
 *   - EXPLICIT GAS, ALWAYS. The SDK's sizing dry run comes back short and
 *     reverts OutOfGas before the wallet is ever raised, so the user sees a
 *     refusal with no signature prompt at all.
 *   - ESCALATE ONCE ON OutOfGas. Four rapid signed writes cost more than four
 *     separate ones, and half the chain's allowance was going unasked.
 *   - CONFIRM FROM THE CHAIN, NOT THE RECEIPT. Four transactions came back ok
 *     and one picture arrived. Counting the ok answers counts the wrong thing.
 */
import { createContract } from '@parity/product-sdk/contracts';
import { sharedChain } from './conn.ts';
import { DOTMAIL, type MailStore, type Head, type Body } from './store.ts';
import { SLOTS } from './seal.ts';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hex, unhex } from './keys.ts';
import ABI from './dotmail-abi.json';

/**
 * The .dot this app is published under, and the string the host scopes its
 * derived account by. A different name here is a DIFFERENT ACCOUNT and so a
 * different mailbox: get it wrong and everybody quietly writes from an identity
 * their letters are not addressed to.
 *
 * `dotmail` itself needs Full Personhood — anything under nine characters does —
 * so the registered name is this one.
 */
const APP_NAME = 'dotmailbox.dot';

/* Weights. Sized for a 16 kB write, clamped to what the chain allows. */
const LIMITS = {
  gasLimit: { ref_time: 1_400_000_000_000n, proof_size: 5_000_000n },
  storageDepositLimit: 10n ** 18n,
};
/* Reached only after an OutOfGas: 90% of a normal extrinsic's ceiling. */
const MAX_LIMITS = {
  gasLimit: { ref_time: 1_439_887_500_000n, proof_size: 7_549_747n },
  storageDepositLimit: 10n ** 18n,
};

const isOutOfGas = (why: string) => /OutOfGas/i.test(why);

/**
 * A public key as pallet-revive addresses it.
 *
 * AccountId32Mapper branches: an account already derived from an eth address is
 * `[addr20, 0xEE * 12]` and keeps those 20 bytes; anything else is keccak'd and
 * the last 20 taken. Truncating unconditionally would produce a plausible
 * address that is simply somebody else's.
 */
function h160Of(publicKey: Uint8Array): string {
  const hx = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  let ethDerived = publicKey.length === 32;
  if (ethDerived) for (let i = 20; i < 32; i++) if (publicKey[i] !== 0xee) { ethDerived = false; break; }
  return ethDerived ? hx(publicKey.slice(0, 20)) : hx(keccak_256(publicKey).slice(12, 32));
}

type AnyContract = {
  [k: string]: {
    query: (...a: unknown[]) => Promise<{ value?: unknown; ok?: boolean }>;
    tx: (...a: unknown[]) => Promise<{ ok?: boolean } & Record<string, unknown>>;
  };
};

/** Bytes off the chain arrive as a Binary, a hex string, or already decoded. */
const bytesOf = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  const asHex = (v as { asHex?: () => string })?.asHex;
  return unhex(typeof asHex === 'function' ? asHex.call(v) : String(v ?? ''));
};

const reason = (r: unknown): string => {
  try { return JSON.stringify(r).slice(0, 220); } catch { return String(r); }
};

export class ContractStore implements MailStore {
  readonly kind = 'chain' as const;
  readonly where = DOTMAIL;

  private c: AnyContract;
  private who: string | null;

  private constructor(c: AnyContract, who: string | null) {
    this.c = c;
    this.who = who;
  }

  /**
   * Build one, or return null when this context cannot read the chain.
   *
   * Tested by attempting a READ, never by asking whether a signer exists: the
   * dot.li gateway hands out a session with a signer and a provider that
   * cannot read a thing, and believing the signer there cost a day.
   */
  static async open(): Promise<ContractStore | null> {
    try {
      // The SHARED connection. Opening a second client on the same host
      // provider does not give two connections, it gives one that works and one
      // that hangs: this store read fine while every lookup in names.ts sat
      // there forever, on its own second client, until they were merged.
      const conn = await sharedChain();
      if (!conn) return null;

      // The app-scoped account, named by the .dot this app belongs to.
      const accounts = await conn.host.getAccountsProvider();
      // The contract records msg.sender, an H160, so `me()` has to be the same
      // H160 or Sent and Inbox swap places. A ProductAccount hands back a
      // public key, and the mapping is not a plain truncation: an eth-derived
      // account is [addr20, 0xEE * 12] and keeps its first 20 bytes verbatim,
      // anything else is keccak'd. Getting this wrong is silent and total.
      const account = accounts
        ? await accounts.getProductAccount(APP_NAME).match(
          (a: { publicKey: Uint8Array }) => h160Of(a.publicKey),
          () => null,
        )
        : null;

      const c = createContract(conn.rt, DOTMAIL, ABI, {}) as unknown as AnyContract;

      // The proof that this context can actually read. An answer, any answer.
      const probe = await c.count.query();
      if (probe?.value === undefined) return null;

      return new ContractStore(c, account ?? null);
    } catch {
      return null;
    }
  }

  async me() { return this.who; }

  /** A read that swallows its own failure into `undefined` would turn a bad
   *  network into an empty mailbox. Everything here returns null instead. */
  private async read<T>(fn: () => Promise<{ value?: unknown }>): Promise<T | null> {
    try {
      const r = await fn();
      return r?.value === undefined ? null : (r.value as T);
    } catch {
      return null;
    }
  }

  async count(): Promise<number | null> {
    const v = await this.read<bigint>(() => this.c.count.query());
    return v === null ? null : Number(v);
  }

  async heads(start: number, n: number): Promise<Head[] | null> {
    const v = await this.read<unknown>(() => this.c.heads.query(BigInt(start), BigInt(n)));
    if (v === null) return null;
    const arr = v as Record<string, unknown> & unknown[];
    // Tags come back FLAT, SLOTS per envelope, as the contract documents.
    const tags = (arr[0] ?? arr.tags) as unknown[];
    const ephs = (arr[1] ?? arr.ephs) as unknown[];
    if (!Array.isArray(tags) || !Array.isArray(ephs)) return null;
    return ephs.map((e, i) => ({
      id: start + i,
      tags: tags.slice(i * SLOTS, i * SLOTS + SLOTS).map(bytesOf),
      eph: bytesOf(e),
    }));
  }

  async bodies(ids: number[]): Promise<Body[] | null> {
    if (!ids.length) return [];
    const v = await this.read<unknown>(() => this.c.bodies.query(ids.map((i) => BigInt(i))));
    if (v === null) return null;
    const arr = v as Record<string, unknown> & unknown[];
    const out = (arr[0] ?? arr.out) as unknown[];
    const froms = (arr[1] ?? arr.froms) as unknown[];
    const times = (arr[2] ?? arr.times) as unknown[];
    if (!Array.isArray(out)) return null;
    return ids.map((id, i) => ({
      id,
      sealed: bytesOf(out[i]),
      from: String((froms?.[i] as { asHex?: () => string })?.asHex?.() ?? froms?.[i] ?? ''),
      time: Number(times?.[i] ?? 0),
    }));
  }

  async keyOf(who: string): Promise<Uint8Array | null | undefined> {
    const v = await this.read<unknown>(() => this.c.keyOf.query(who));
    if (v === null) return null;                 // could not ask
    const b = bytesOf(v);
    return b.length === 32 && b.some((x) => x !== 0) ? b : undefined;   // asked; none published
  }

  /** One write, with a single escalation if the chain says it ran out. */
  private async write(
    method: string,
    args: unknown[],
    escalated = false,
  ): Promise<{ ok: boolean; why?: string }> {
    try {
      const r = await this.c[method].tx(...args, escalated ? MAX_LIMITS : LIMITS);
      if (r && r.ok === false) {
        const why = reason(r);
        if (isOutOfGas(why) && !escalated) return this.write(method, args, true);
        return { ok: false, why };
      }
      return { ok: true };
    } catch (e) {
      const why = (e as Error)?.message ?? String(e);
      if (isOutOfGas(why) && !escalated) return this.write(method, args, true);
      return { ok: false, why };
    }
  }

  async setKey(pub: Uint8Array) {
    return this.write('setKey', ['0x' + hex(pub)]);
  }

  async send(tags: Uint8Array[], eph: Uint8Array, sealed: Uint8Array) {
    const before = await this.count();
    const r = await this.write('send', [
      tags.map((t) => '0x' + hex(t)),
      '0x' + hex(eph),
      '0x' + hex(sealed),
    ]);
    if (!r.ok) return r;

    // The receipt said yes. Ask the chain whether anything arrived, because a
    // transaction that came back ok and changed nothing is a thing that has
    // happened here more than once.
    const after = await this.count();
    if (before !== null && after !== null && after <= before) {
      return { ok: false, why: 'the write was accepted but the chain holds no more envelopes than before' };
    }
    return { ok: true };
  }
}
