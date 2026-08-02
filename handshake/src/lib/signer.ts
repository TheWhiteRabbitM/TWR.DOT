import { useEffect, useState } from 'react';
import { getAccountsProvider, requestPermission } from '@parity/product-sdk/host';
import type { AccountsProvider, HostAccount } from '@parity/product-sdk/host';
import { deriveH160, ss58Encode } from '@parity/product-sdk/address';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { HexString, PolkadotSigner } from 'polkadot-api';
import type { ChainAccess } from './chainDriver';
import { APP_NAME } from './config';

/**
 * WHY THIS FILE NO LONGER USES `SignerManager`
 *
 * `new SignerManager({ dappName })` never touches the user's wallet. Inside the
 * Polkadot host, `HostProvider.tryConnect()` takes the `dappName` branch and
 * calls `getProductAccount("handshake.dot", 0)` — an APP-SCOPED account the host
 * derives for this app. It starts empty, the user cannot see or fund it from the
 * wallet UI, and every signature (even a fee-only one) is paid from it, so
 * transactions fail with `Revive.TransferFailed` / "Inability to pay some fees".
 * `SignerManager` has no legacy-account path at all.
 *
 * So we go through the accounts provider directly and prefer the user's REAL
 * accounts (`getLegacyAccounts`), picking the best-funded one. The app-scoped
 * account stays as a fallback for hosts that expose no wallet accounts — and
 * when it is in use the UI says so, with the address to fund.
 */

/** 'wallet' = one of the user's own accounts; 'app' = the host-derived one. */
export type AccountKind = 'wallet' | 'app';

export interface ConnectedAccount {
  /** SS58 address (prefix 42) — the tx origin and the mapped account. */
  address: string;
  /** pallet-revive H160 for contract reads about this person. */
  h160Address: HexString;
  publicKey: Uint8Array;
  /** Wallet account name, or the host username — whatever we could learn. */
  name: string | null;
  kind: AccountKind;
  signer: PolkadotSigner;
}

export type AccountState =
  | { status: 'connecting'; account: null; error: null }
  | { status: 'connected'; account: ConnectedAccount; error: null }
  | { status: 'error'; account: null; error: Error };

const SS58_PREFIX = 42;
/** How `SignerManager` derived the app-scoped identifier from a dapp name. */
const PRODUCT_ID = APP_NAME.endsWith('.dot') ? APP_NAME : `${APP_NAME}.dot`;

const HOST_TIMEOUT_MS = 15_000;
const ACCOUNT_TIMEOUT_MS = 10_000;
const BALANCE_TIMEOUT_MS = 8_000;
/** Reading balances is only there to rank accounts — never let it block a boot. */
const RANK_LIMIT = 6;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

interface Candidate {
  publicKey: Uint8Array;
  name: string | null;
  address: string;
}

function toCandidate(account: HostAccount): Candidate {
  const name = typeof account.name === 'string' && account.name.trim() ? account.name.trim() : null;
  return { publicKey: account.publicKey, name, address: ss58Encode(account.publicKey, SS58_PREFIX) };
}

/**
 * Of the user's accounts, the one that can actually pay. Balance reads are best
 * effort — if they all fail we take the first, which is the old behaviour.
 */
async function richest(chain: ChainAccess, candidates: Candidate[]): Promise<Candidate> {
  if (candidates.length === 1) return candidates[0];
  try {
    await withTimeout(chain.connect({ assetHub: devnet_asset_hub }), HOST_TIMEOUT_MS, 'chain connect');
    const api = chain.getRawClient(devnet_asset_hub).getTypedApi(devnet_asset_hub);
    const ranked = await Promise.all(
      candidates.slice(0, RANK_LIMIT).map(async (candidate) => {
        try {
          const account = await withTimeout(
            api.query.System.Account.getValue(candidate.address),
            BALANCE_TIMEOUT_MS,
            'balance',
          );
          return { candidate, free: BigInt(account?.data?.free ?? 0n) };
        } catch {
          return { candidate, free: 0n };
        }
      }),
    );
    ranked.sort((a, b) => (b.free > a.free ? 1 : b.free < a.free ? -1 : 0));
    return ranked[0].candidate;
  } catch {
    return candidates[0];
  }
}

/** The host's primary username — best effort, never fatal. */
async function hostUsername(provider: AccountsProvider): Promise<string | null> {
  try {
    return await withTimeout(
      provider.getUserId().match(
        (id) => (id.primaryUsername?.trim() ? id.primaryUsername.trim() : null),
        () => null,
      ),
      ACCOUNT_TIMEOUT_MS,
      'user id',
    );
  } catch {
    return null;
  }
}

async function legacyAccounts(provider: AccountsProvider): Promise<HostAccount[]> {
  try {
    const accounts = await withTimeout(
      provider.getLegacyAccounts().match(
        (list) => list,
        () => [] as HostAccount[],
      ),
      ACCOUNT_TIMEOUT_MS,
      'wallet accounts',
    );
    return accounts.filter((account) => account?.publicKey?.length);
  } catch {
    return [];
  }
}

async function productAccount(provider: AccountsProvider): Promise<ConnectedAccount | null> {
  try {
    const account = await withTimeout(
      provider.getProductAccount(PRODUCT_ID, 0).match(
        (value) => value,
        () => null,
      ),
      ACCOUNT_TIMEOUT_MS,
      'app account',
    );
    if (!account?.publicKey?.length) return null;
    return {
      address: ss58Encode(account.publicKey, SS58_PREFIX),
      h160Address: deriveH160(account.publicKey),
      publicKey: account.publicKey,
      name: await hostUsername(provider),
      kind: 'app',
      signer: provider.getProductAccountSigner(account),
    };
  } catch {
    return null;
  }
}

async function connect(chain: ChainAccess): Promise<ConnectedAccount> {
  const provider = await withTimeout(getAccountsProvider(), HOST_TIMEOUT_MS, 'host accounts');
  if (!provider) {
    throw new Error(
      'No wallet available — open Handshake inside the Polkadot app to make agreements.',
    );
  }

  // `SignerManager` used to ask for this after connecting; without it the host
  // rejects every signature with PermissionDenied. A refusal is not fatal here:
  // the transaction itself will surface it with a message the user can act on.
  try {
    await withTimeout(
      requestPermission({ tag: 'ChainSubmit', value: undefined }),
      HOST_TIMEOUT_MS,
      'permission request',
    );
  } catch {
    /* the host declined or timed out — let the first signature report it */
  }

  const wallet = await legacyAccounts(provider);
  if (wallet.length) {
    const best = await richest(chain, wallet.map(toCandidate));
    return {
      address: best.address,
      h160Address: deriveH160(best.publicKey),
      publicKey: best.publicKey,
      name: best.name ?? (await hostUsername(provider)),
      kind: 'wallet',
      signer: provider.getLegacyAccountSigner({
        publicKey: best.publicKey,
        name: best.name ?? undefined,
      }),
    };
  }

  const derived = await productAccount(provider);
  if (derived) return derived;

  throw new Error(
    'The Polkadot app did not offer an account to sign with. Unlock your wallet and reopen Handshake.',
  );
}

/**
 * Only a SUCCESSFUL connection is memoised. Caching a failure would make one
 * bad boot permanent: every later retry would return the same dead session.
 */
let session: Promise<ConnectedAccount> | null = null;

export function connectHostAccount(chain: ChainAccess): Promise<ConnectedAccount> {
  if (!session) {
    const pending = connect(chain);
    session = pending;
    void pending.catch(() => {
      if (session === pending) session = null;
    });
  }
  return session;
}

/** Resolve the signing account once, and report the attempt to the UI. */
export function useHostAccount(chain: ChainAccess): AccountState {
  const [state, setState] = useState<AccountState>({
    status: 'connecting',
    account: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'connecting', account: null, error: null });
    void connectHostAccount(chain)
      .then((account) => {
        if (!cancelled) setState({ status: 'connected', account, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          account: null,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [chain]);

  return state;
}
