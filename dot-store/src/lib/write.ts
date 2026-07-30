import { encodeReview } from './chain';
import { APP_REVIEWS, DEVNET_CHAIN_ID, DEVNET_CHAIN_PARAMS } from './config';
import { APP_REVIEWS_ABI } from './reviews-abi';

/**
 * Posting a review, for real, by whichever route the reader actually has.
 *
 * This module is imported dynamically, on submit only. The SDK signing stack it
 * can reach for — polkadot-api, the chain descriptors, the Asset Hub metadata —
 * is megabytes, and a visitor who only browses must never download it.
 *
 * There are three routes, tried in order of how much they can do:
 *
 *   1. Inside the Polkadot app, sign through the host's own account.
 *   2. Outside it, sign with an injected EVM wallet if there is one. The devnet
 *      Asset Hub is EVM-compatible and AppReviews is an ordinary contract, so
 *      this needs no library at all — the calldata is the same hand-rolled
 *      encoding the read path already uses, and the wallet does the signing.
 *      This route did not exist before, which is why a review posted from a
 *      normal browser could only ever be kept on the device.
 *   3. Nothing to sign with: keep the review locally and SAY SO.
 *
 * The honest-failure rule: those outcomes are never blurred. `onchain` means a
 * transaction was accepted and we hold its hash. `local` means no signer was
 * reachable at all. `error` means we tried to sign and it failed — including
 * when the reader declines. A failure never masquerades as "saved locally", and
 * no path fabricates a transaction.
 */

export type PostRoute = 'host' | 'wallet';

export type PostOutcome =
  | { kind: 'onchain'; via: PostRoute; hash?: string }
  | { kind: 'local'; why: string }
  | { kind: 'error'; why: string; step: string };

export interface PostArgs {
  label: string;
  name: string;
  rating: number;
  body: string;
  /** Progress, so a slow chain step is visible instead of looking hung. */
  onStep?: (step: string) => void;
}

/** Nothing here should hang forever; every await is bounded. */
const CONNECT_MS = 30_000;
const MAP_MS = 120_000;
const TX_MS = 180_000;
/** How long to wait for the host to hand us an account after connecting. */
const ACCOUNT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, bell]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Turn whatever was thrown into one sentence a person can act on.
 *
 * The ABI carries the contract's custom errors, so an SDK revert arrives
 * decoded; an injected wallet returns a numeric code instead. Both are mapped
 * onto the same plain language, and anything unrecognised is passed through
 * rather than replaced with an explanation we invented.
 */
function explain(e: unknown): string {
  const err = e as { message?: string; code?: number; data?: { message?: string } } | undefined;
  const raw = [err?.message, err?.data?.message, typeof e === 'string' ? e : '']
    .filter(Boolean)
    .join(' ');
  if (err?.code === 4001) return 'the signature was declined';
  if (err?.code === -32002) return 'your wallet already has a pending request — open it and finish that first';
  if (/AlreadyReviewed/i.test(raw)) return 'you have already reviewed this app';
  if (/NotHuman/i.test(raw)) return 'this contract now requires proof of personhood';
  if (/BadRating/i.test(raw)) return 'the rating must be between 1 and 5';
  if (/BadBody/i.test(raw)) return 'the review is longer than 280 bytes';
  if (/BadLabel|BadName/i.test(raw)) return 'the app name is not one the contract will accept';
  if (/UnknownApp/i.test(raw)) return 'the contract does not know this app yet';
  if (/AccountUnmapped|AccountNotMapped/i.test(raw))
    return 'this account is not mapped for contracts yet — try once more';
  if (/insufficient funds|balance too low/i.test(raw))
    return 'this account has no devnet balance to pay the fee';
  if (/cancel|reject|denied|dismiss|user rejected/i.test(raw)) return 'the signature was declined';
  return (raw || String(e)).split('\n')[0].slice(0, 200);
}

/* ------------------------------------------------------------------ wallet */

interface Injected {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Injected | null {
  const w = window as unknown as { ethereum?: Injected };
  return w.ethereum ?? null;
}

/**
 * Post through an injected EVM wallet.
 *
 * Deliberately no library: `eth_sendTransaction` with the calldata the read
 * path already knows how to build is the entire requirement. The wallet is the
 * consent surface — it shows the contract, the network and the fee, and nothing
 * is sent until the reader approves there.
 */
async function postViaWallet(eth: Injected, args: PostArgs): Promise<PostOutcome> {
  const { label, name, rating, body, onStep } = args;
  let step = 'connecting your wallet';
  try {
    onStep?.(step);
    const accounts = (await withTimeout(
      eth.request({ method: 'eth_requestAccounts' }) as Promise<string[]>,
      CONNECT_MS,
      'wallet connect',
    )) as string[];
    const from = accounts?.[0];
    if (!from) return { kind: 'local', why: 'the wallet did not share an account' };

    // Signing against the wrong network would produce a transaction that looks
    // fine and does nothing here, so the chain is checked before anything else.
    step = 'checking the network';
    onStep?.(step);
    const chainId = (await eth.request({ method: 'eth_chainId' })) as string;
    if (chainId?.toLowerCase() !== DEVNET_CHAIN_ID) {
      step = 'switching to the devnet';
      onStep?.(step);
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: DEVNET_CHAIN_ID }],
        });
      } catch (e) {
        // 4902: the wallet has never heard of this chain. Offer to add it — the
        // wallet still asks the reader before anything changes.
        if ((e as { code?: number })?.code === 4902) {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [DEVNET_CHAIN_PARAMS],
          });
        } else {
          throw e;
        }
      }
    }

    step = 'waiting for your signature';
    onStep?.(step);
    const hash = (await withTimeout(
      eth.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: APP_REVIEWS, data: encodeReview(label, name, rating, body) }],
      }) as Promise<string>,
      TX_MS,
      'review transaction',
    )) as string;

    return { kind: 'onchain', via: 'wallet', hash };
  } catch (e) {
    return { kind: 'error', why: explain(e), step };
  }
}

/* -------------------------------------------------------------------- host */

async function postViaHost(args: PostArgs): Promise<PostOutcome> {
  const { label, name, rating, body, onStep } = args;
  let step = 'starting';
  try {
    const [host, { SignerManager }, contracts, descriptors, papi] = await Promise.all([
      import('@parity/product-sdk-host'),
      import('@parity/product-sdk-signer'),
      import('@parity/product-sdk/contracts'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      import('polkadot-api'),
    ]);

    step = 'connecting your account';
    onStep?.(step);
    const manager = new SignerManager({ dappName: 'dot-store.dot' });
    const connected = await withTimeout(manager.connect(), CONNECT_MS, 'signer connect');
    if (!connected.ok) {
      return { kind: 'local', why: 'no account is connected in the Polkadot app' };
    }

    // connect() resolves with the account list, but the selected account is set
    // asynchronously by the manager. Wait for one rather than racing it.
    const account = await (async () => {
      const deadline = Date.now() + ACCOUNT_MS;
      for (;;) {
        const s = manager.getState();
        if (s.selectedAccount) return s.selectedAccount;
        const first = s.accounts[0];
        if (first) {
          const picked = manager.selectAccount(first.address);
          if (picked.ok) return picked.value;
        }
        if (Date.now() > deadline) return null;
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    if (!account) {
      return { kind: 'local', why: 'the Polkadot app did not offer an account to sign with' };
    }

    const signer = manager.getSigner();
    if (!signer) {
      return { kind: 'local', why: 'no signer available for the selected account' };
    }

    // The connection has to be the host's, not one we open ourselves, or the
    // shell raises a "Direct Chain Access" warning at the user. getHostProvider
    // IS that shared connection, wrapped as a PAPI provider.
    //
    // We deliberately do NOT go through createApp() here: it registers every
    // chain the SDK knows, which drags Paseo, Kusama, Polkadot and Individuality
    // metadata into the build — five blobs of 550-880 KB this store never talks
    // to. The genesis hash comes off the descriptor itself, so nothing is
    // hardcoded and nothing is guessed.
    step = 'connecting to Asset Hub';
    onStep?.(step);
    const genesis = (descriptors.devnet_asset_hub as unknown as { genesis: `0x${string}` }).genesis;
    const provider = await withTimeout(host.getHostProvider(genesis), CONNECT_MS, 'host provider');
    if (!provider) {
      return { kind: 'local', why: 'the host would not share its chain connection' };
    }
    const client = papi.createClient(provider);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtime = (contracts as any).createContractRuntimeFromClient(
      client,
      descriptors.devnet_asset_hub,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = (contracts as any).createContract(runtime, APP_REVIEWS, APP_REVIEWS_ABI, {
      signerManager: manager,
    });

    // pallet-revive rejects an unmapped origin with AccountUnmapped, and a fresh
    // account is always unmapped. This submits a mapping transaction the first
    // time only — which is why it is here, on the write path, and not on load.
    step = 'preparing your account';
    onStep?.(step);
    const mapped = (await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contracts as any).ensureContractAccountMapped(runtime, account.address, signer),
      MAP_MS,
      'account mapping',
    )) as { ok: boolean; error?: unknown } | undefined;
    if (mapped && mapped.ok === false) {
      return { kind: 'error', why: explain(mapped.error), step };
    }

    // .tx() dry-runs first, so AlreadyReviewed or NotHuman surfaces as a decoded
    // revert before anything is signed or paid for.
    step = 'waiting for your signature';
    onStep?.(step);
    await withTimeout(contract.review.tx(label, name, rating, body), TX_MS, 'review transaction');

    return { kind: 'onchain', via: 'host' };
  } catch (e) {
    return { kind: 'error', why: explain(e), step };
  }
}

/* ------------------------------------------------------------------- entry */

export async function postReview(args: PostArgs): Promise<PostOutcome> {
  // Inside the container the host owns the keys and the chain connection, so
  // that route is preferred even when a browser wallet is also present.
  let inside = false;
  try {
    const host = await import('@parity/product-sdk-host');
    inside = await host.isInsideContainer().catch(() => false);
  } catch {
    inside = false;
  }

  if (inside) {
    const out = await postViaHost(args);
    // If the host simply has nobody to sign with, an injected wallet is still
    // worth trying before falling back to the device.
    if (out.kind === 'local') {
      const eth = injected();
      if (eth) return postViaWallet(eth, args);
    }
    return out;
  }

  const eth = injected();
  if (eth) return postViaWallet(eth, args);

  return {
    kind: 'local',
    why: 'no Polkadot app and no browser wallet to sign with',
  };
}
