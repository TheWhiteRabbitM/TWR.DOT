import { useEffect, useState } from 'react';
import { getAccountsProvider } from '@parity/product-sdk/host';
import { deriveH160, ss58Encode } from '@parity/product-sdk/address';
import type { PolkadotSigner } from 'polkadot-api';
import { CONTEXT, DEVNET } from './config';

/**
 * Who signs, and who pays.
 *
 * WHY NOT SignerManager
 *   `new SignerManager({ dappName })` looks like the obvious way in, but inside
 *   the Polkadot host it never touches the user's wallet: HostProvider.tryConnect
 *   takes the `dappName` branch and returns `getProductAccount(dappName, 0)` —
 *   an APP-SCOPED account the host derives for this app. `SignerManager` has no
 *   path to the user's own keys at all. That account starts empty and is not
 *   visible in the wallet UI, so:
 *     - the press transaction can die on fees ("Inability to pay some fees",
 *       Revive.TransferFailed) with nothing the user can do about it, and
 *     - worse for The Button specifically, personhood is attached to the
 *       PERSON'S account. An app-scoped account has tier 0, so every real human
 *       would land on the "PERSONHOOD REQUIRED" screen forever.
 *
 * So this module goes to the accounts provider directly and prefers the user's
 * REAL accounts (`getLegacyAccounts`), picking the best-funded one. The
 * app-scoped account stays as a FALLBACK for hosts that expose no wallet
 * accounts, and the UI says when it is in use so the address can be funded.
 */

/** How long any single host handshake may take before it counts as failed. */
const PROVIDER_TIMEOUT_MS = 15_000;
const ACCOUNTS_TIMEOUT_MS = 10_000;
/** Balance reads only rank accounts, so they get a short leash. */
const BALANCE_TIMEOUT_MS = 8_000;
/** Ranking every account of a large wallet is not worth the round trips. */
const RANKED_MAX = 6;

/** 'wallet' = one of the user's own accounts; 'app' = the host-derived one. */
export type AccountKind = 'wallet' | 'app';

/** The account The Button reads as, maps, and signs with. */
export interface ButtonAccount {
  /** SS58 address. Dry-run origin and the account pallet-revive maps. */
  address: string;
  /**
   * EVM address of the same key. `snapshot(address)` and the personhood
   * precompile take this — passing the SS58 address reads the wrong account.
   */
  h160Address: `0x${string}`;
  /** Human-readable name, when the host has one. */
  name: string | null;
  kind: AccountKind;
  signer: PolkadotSigner;
}

export type AccountState =
  | { status: 'connecting'; account: null; error: null }
  | { status: 'connected'; account: ButtonAccount; error: null }
  | { status: 'error'; account: null; error: string };

/**
 * Reads free balances (planck) for a list of addresses, positionally.
 *
 * Injected rather than fetched here on purpose: chain access belongs to the SDK
 * app instance, which reuses the container's connection. Opening one from this
 * module would make the host raise a "Direct Chain Access" warning at the user.
 * Best effort — any entry may come back null, and the whole call may reject.
 */
export type BalanceReader = (addresses: string[]) => Promise<(bigint | null)[]>;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A host account as it arrives from the provider: public key, maybe a name. */
interface RawAccount {
  publicKey: Uint8Array;
  name?: string | null;
}

function describe(raw: RawAccount, kind: AccountKind, signer: PolkadotSigner): ButtonAccount {
  return {
    address: ss58Encode(raw.publicKey, DEVNET.ss58Prefix),
    h160Address: deriveH160(raw.publicKey),
    name: raw.name ?? null,
    kind,
    signer,
  };
}

/**
 * Of the user's accounts, the one that can actually pay.
 *
 * Ranking is advisory: if the reader is missing or every read fails, this falls
 * back to the first account, which is the behaviour a single-account wallet had
 * anyway.
 */
async function richest(accounts: RawAccount[], readBalances?: BalanceReader): Promise<RawAccount> {
  if (accounts.length === 1 || !readBalances) return accounts[0];

  const ranked = accounts.slice(0, RANKED_MAX);
  try {
    const balances = await withTimeout(
      readBalances(ranked.map((a) => ss58Encode(a.publicKey, DEVNET.ss58Prefix))),
      BALANCE_TIMEOUT_MS,
      'balance ranking',
    );
    let best = 0;
    let bestFree = balances[0] ?? 0n;
    for (let i = 1; i < ranked.length; i += 1) {
      const free = balances[i] ?? 0n;
      if (free > bestFree) {
        best = i;
        bestFree = free;
      }
    }
    return ranked[best];
  } catch {
    return accounts[0];
  }
}

/**
 * The neverthrow-style `ResultAsync` the provider returns is a thenable, not a
 * Promise, so every call is wrapped in `Promise.resolve` before it is awaited.
 * Its `ok` payload lives on `.value`; the shape is deliberately untyped here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function unwrap<T>(result: any, ms: number, label: string): Promise<T | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settled: any = await withTimeout(Promise.resolve(result), ms, label);
  return settled?.value as T | undefined;
}

async function connect(readBalances?: BalanceReader): Promise<ButtonAccount> {
  const provider = await withTimeout(
    getAccountsProvider(),
    PROVIDER_TIMEOUT_MS,
    'accounts provider',
  );
  if (!provider) {
    throw new Error('no host accounts provider — open The Button in the Polkadot app');
  }

  // The user's own accounts first: they hold the funds and, crucially for this
  // app, the personhood credential.
  try {
    const wallet = await unwrap<RawAccount[]>(
      provider.getLegacyAccounts(),
      ACCOUNTS_TIMEOUT_MS,
      'wallet accounts',
    );
    const usable = (wallet ?? []).filter((a) => a?.publicKey);
    if (usable.length > 0) {
      const best = await richest(usable, readBalances);
      const signer = provider.getLegacyAccountSigner({
        publicKey: best.publicKey,
        name: best.name ?? undefined,
      });
      return describe(best, 'wallet', signer);
    }
  } catch {
    // Host exposes no wallet accounts on this build — fall through.
  }

  // Fallback: the app-scoped account. It signs fine, but it starts empty and
  // carries no personhood, so the UI has to name it rather than let the user
  // stare at an unexplained refusal.
  const productAccount = await unwrap<Parameters<typeof provider.getProductAccountSigner>[0]>(
    provider.getProductAccount(CONTEXT, 0),
    ACCOUNTS_TIMEOUT_MS,
    'app account',
  );
  if (!productAccount?.publicKey) {
    throw new Error('the host returned no account to sign with');
  }
  return describe(productAccount, 'app', provider.getProductAccountSigner(productAccount));
}

let pending: Promise<ButtonAccount> | null = null;

/**
 * The connected account, resolved once per page load.
 *
 * Only a SUCCESSFUL connection is memoised. Caching a failure would make one
 * bad boot permanent: every later retry would hand back the same dead promise.
 */
export function getAccount(readBalances?: BalanceReader): Promise<ButtonAccount> {
  if (!pending) {
    const attempt = connect(readBalances);
    pending = attempt;
    void attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
  }
  return pending;
}

/** Resolve the signing account, as React state. */
export function useAccount(readBalances?: BalanceReader): AccountState {
  const [state, setState] = useState<AccountState>({
    status: 'connecting',
    account: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void getAccount(readBalances).then(
      (account) => {
        if (!cancelled) setState({ status: 'connected', account, error: null });
      },
      (error) => {
        if (!cancelled) setState({ status: 'error', account: null, error: message(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [readBalances]);

  return state;
}
