import { useEffect, useState } from 'react';
import { getAccountsProvider, requestPermission } from '@parity/product-sdk/host';
import type { AccountsProvider, HostAccount } from '@parity/product-sdk/host';
import { deriveH160, ss58Encode } from '@parity/product-sdk/address';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { HexString, PolkadotSigner } from 'polkadot-api';
import type { ChainAccess } from './chainDriver';
import { APP_NAME } from './config';

/**
 * Who signs, and — more to the point — who pays.
 *
 * The obvious call, `new SignerManager({ dappName })`, does NOT use the
 * person's wallet. Inside the Polkadot host it takes the `dappName` branch and
 * asks for `getProductAccount('openpetition.dot', 0)`: an APP-SCOPED account the
 * host derives for this app. That account starts empty and is invisible in the
 * wallet UI, so every transaction that has to pay a fee — signing a petition,
 * opening one, even the one-off pallet-revive account mapping — can die with
 * "Inability to pay some fees" / `Revive.TransferFailed`, and anything recorded
 * lands under an address that is not the person's.
 *
 * So this module goes to the accounts provider directly and prefers the user's
 * REAL wallet accounts (`getLegacyAccounts`), picking the best-funded one when
 * there is more than one. The app-scoped product account stays as a fallback for
 * hosts that expose no wallet accounts at all — and when it is in use the UI says
 * so, with the address, so the account can be funded on purpose instead of a
 * transaction failing for reasons nobody can see.
 */

/** SS58 prefix the host wallet uses (generic Substrate), as SignerManager did. */
const SS58_PREFIX = 42;

/** The identifier the host derives the app-scoped account from — the same one
 *  SignerManager's `dappName` branch would have produced. */
const PRODUCT_ID = APP_NAME.endsWith('.dot') ? APP_NAME : `${APP_NAME}.dot`;

const HOST_TIMEOUT_MS = 15_000;
const ACCOUNT_TIMEOUT_MS = 10_000;
const BALANCE_TIMEOUT_MS = 8_000;
/** Never rank more accounts than this — each one costs a storage read. */
const RANK_MAX = 6;

/** 'wallet' = one of the person's own accounts; 'app' = the host-derived one. */
export type AccountKind = 'wallet' | 'app';

export interface ConnectedAccount {
  /** SS58 address — signs transactions and pays for them. */
  readonly address: string;
  /** EVM address of the same account — what `me(address, id)` actually takes. */
  readonly h160Address: HexString;
  readonly publicKey: Uint8Array;
  /** DotNS username or wallet label, when the host exposes one. */
  readonly name: string | null;
  readonly signer: PolkadotSigner;
  readonly kind: AccountKind;
}

export interface HostAccountState {
  status: 'connecting' | 'ready' | 'error';
  account: ConnectedAccount | null;
  error: Error | null;
}

/** Every await is bounded — a hang must become a named error, not a spinner. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * The host's DotNS username, best effort. SignerManager fetched this to name the
 * product account; the register shows it beside the verification badge, so it has
 * to survive the switch to wallet accounts.
 */
async function primaryUsername(provider: AccountsProvider): Promise<string | null> {
  try {
    return await withTimeout(
      provider.getUserId().match(
        (id) => id.primaryUsername as string | null,
        () => null,
      ),
      ACCOUNT_TIMEOUT_MS,
      'user id',
    );
  } catch {
    return null;
  }
}

/**
 * Ask the host for permission to submit transactions. SignerManager did this on
 * connect and only logged the outcome — a refusal shows up as a real error on the
 * first `.tx()`, which says far more than a permission flag would here.
 */
async function requestChainSubmit(): Promise<void> {
  try {
    await withTimeout(
      requestPermission({ tag: 'ChainSubmit', value: undefined }),
      HOST_TIMEOUT_MS,
      'chain submit permission',
    );
  } catch {
    // Not fatal: the signing path reports what actually went wrong.
  }
}

/** The user's own wallet accounts, or an empty list if the host has none. */
async function walletAccounts(provider: AccountsProvider): Promise<HostAccount[]> {
  try {
    const accounts = await withTimeout(
      provider.getLegacyAccounts().match(
        (list) => list,
        () => [] as HostAccount[],
      ),
      ACCOUNT_TIMEOUT_MS,
      'wallet accounts',
    );
    return (accounts ?? []).filter((a) => a?.publicKey && a.publicKey.length > 0);
  } catch {
    return [];
  }
}

type Addressed = HostAccount & { address: string };

/**
 * Of the person's accounts, the one that can actually pay. Balance reads are best
 * effort: if the chain is unreachable, or every read fails, we take the first —
 * which is the behaviour without this step, never worse than it.
 */
async function richest(accounts: HostAccount[], chain: ChainAccess | null): Promise<Addressed> {
  const addressed: Addressed[] = accounts.map((a) => ({
    ...a,
    address: ss58Encode(a.publicKey, SS58_PREFIX),
  }));
  if (addressed.length === 1 || !chain) return addressed[0];

  try {
    await withTimeout(chain.connect({ assetHub: devnet_asset_hub }), HOST_TIMEOUT_MS, 'chain connect');
    const api = chain.getRawClient(devnet_asset_hub).getTypedApi(devnet_asset_hub);
    const scored = await Promise.all(
      addressed.slice(0, RANK_MAX).map(async (account) => {
        try {
          const info = await withTimeout(
            api.query.System.Account.getValue(account.address),
            BALANCE_TIMEOUT_MS,
            'balance',
          );
          return { account, free: BigInt(info?.data?.free ?? 0) };
        } catch {
          return { account, free: 0n };
        }
      }),
    );
    scored.sort((x, y) => (y.free > x.free ? 1 : y.free < x.free ? -1 : 0));
    return scored[0].account;
  } catch {
    return addressed[0];
  }
}

async function connect(chain: ChainAccess | null): Promise<ConnectedAccount> {
  const provider = await withTimeout(getAccountsProvider(), HOST_TIMEOUT_MS, 'host accounts');
  if (!provider) {
    throw new Error(
      'The Polkadot host exposed no accounts — open OpenPetition inside the Polkadot app.',
    );
  }

  const username = await primaryUsername(provider);

  // The person's own accounts first: they are the ones with funds, and the ones
  // whose signature actually belongs to them.
  const wallet = await walletAccounts(provider);
  if (wallet.length > 0) {
    const best = await richest(wallet, chain);
    await requestChainSubmit();
    return {
      address: best.address,
      h160Address: deriveH160(best.publicKey),
      publicKey: best.publicKey,
      name: best.name ?? username,
      signer: provider.getLegacyAccountSigner({ publicKey: best.publicKey, name: best.name }),
      kind: 'wallet',
    };
  }

  // Fallback: the app-scoped account. It signs perfectly well, it just starts
  // empty — the UI has to name it so somebody can send it a little PAS.
  const product = await withTimeout(
    provider.getProductAccount(PRODUCT_ID, 0).match(
      (account) => account,
      () => null,
    ),
    ACCOUNT_TIMEOUT_MS,
    'app account',
  );
  if (!product) {
    throw new Error(
      'No account available to sign with — the Polkadot host offered neither a wallet account nor an app account.',
    );
  }
  await requestChainSubmit();
  return {
    address: ss58Encode(product.publicKey, SS58_PREFIX),
    h160Address: deriveH160(product.publicKey),
    publicKey: product.publicKey,
    name: username,
    signer: provider.getProductAccountSigner(product),
    kind: 'app',
  };
}

let pending: Promise<ConnectedAccount> | null = null;

/**
 * The connected account, one host handshake per session.
 *
 * Only a SUCCESSFUL connection is memoised: caching a failure would make one bad
 * boot permanent, with every later retry handed the same dead result.
 */
export function connectHostAccount(chain: ChainAccess | null): Promise<ConnectedAccount> {
  if (!pending) {
    const attempt = connect(chain);
    pending = attempt;
    void attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
  }
  return pending;
}

/** Subscribe to the connection; starts it on mount. */
export function useHostAccount(chain: ChainAccess | null): HostAccountState {
  const [state, setState] = useState<HostAccountState>({
    status: 'connecting',
    account: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'connecting', account: null, error: null });
    connectHostAccount(chain)
      .then((account) => {
        if (!cancelled) setState({ status: 'ready', account, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            account: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chain]);

  return state;
}
