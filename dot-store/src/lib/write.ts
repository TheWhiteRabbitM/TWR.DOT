import { APP_REVIEWS } from './config';
import { APP_REVIEWS_ABI } from './reviews-abi';

/**
 * Posting a review, for real.
 *
 * This module is imported dynamically, on submit only. Everything it pulls in —
 * polkadot-api, the chain descriptors, the Asset Hub metadata — is several
 * megabytes, and a visitor who only browses must never download it. That single
 * `await import()` in App.tsx is the whole reason this is a separate file.
 *
 * The honest-failure rule: there are exactly three outcomes, and we never blur
 * them. `onchain` means a transaction was signed and accepted. `local` means no
 * signer was reachable (we are outside the Polkadot app, or no account is
 * connected) and the review was kept on the device instead — stated plainly to
 * the user. `error` means we tried on chain and it failed, including when the
 * user declines the signature. No path fabricates a transaction, and no path
 * reports success it did not observe.
 */

export type PostOutcome =
  | { kind: 'onchain' }
  | { kind: 'local'; why: string }
  | { kind: 'error'; why: string };

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
 * Turn whatever the contract layer threw into one sentence a person can act on.
 *
 * The ABI carries the custom errors, so a revert arrives decoded; this maps the
 * two that a reviewer can actually hit onto plain language, and leaves the rest
 * as-is rather than inventing an explanation.
 */
function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/AlreadyReviewed/i.test(raw)) return 'you have already reviewed this app';
  if (/NotHuman/i.test(raw)) return 'this contract now requires proof of personhood';
  if (/BadRating/i.test(raw)) return 'the rating must be between 1 and 5';
  if (/BadBody/i.test(raw)) return 'the review is longer than 280 bytes';
  if (/UnknownApp/i.test(raw)) return 'the contract does not know this app yet';
  if (/AccountUnmapped|AccountNotMapped/i.test(raw))
    return 'this account is not mapped for contracts yet — try once more';
  if (/cancel|reject|denied|dismiss/i.test(raw)) return 'the signature was declined';
  return raw.split('\n')[0];
}

export async function postReview(args: PostArgs): Promise<PostOutcome> {
  const { label, name, rating, body, onStep } = args;
  const step = (s: string) => onStep?.(s);

  // Outside the host container there is no key to sign with, and the SDK routes
  // every connection through the container's provider with no direct-WebSocket
  // fallback. So this is a fact about the environment, not a failure.
  const host = await import('@parity/product-sdk-host');
  const inside = await host.isInsideContainer().catch(() => false);
  if (!inside) {
    return { kind: 'local', why: 'not running inside the Polkadot app' };
  }

  try {
    const [{ SignerManager }, contracts, descriptors, papi] = await Promise.all([
      import('@parity/product-sdk-signer'),
      import('@parity/product-sdk/contracts'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      import('polkadot-api'),
    ]);

    step('connecting your account');
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
    // We deliberately do NOT go through createApp() here. createApp registers
    // every chain the SDK knows, which drags Paseo, Kusama, Polkadot and
    // Individuality metadata into the build — five blobs of 550-880 KB that this
    // store never talks to. Since our Bulletin authorisation is 57 MiB and the
    // keepalive republishes weekly, those megabytes are a recurring cost, not a
    // one-off. The genesis hash comes off the descriptor itself, so nothing is
    // hardcoded and nothing is guessed.
    step('connecting to Asset Hub');
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
    const contract = (contracts as any).createContract(
      runtime,
      APP_REVIEWS,
      APP_REVIEWS_ABI,
      { signerManager: manager },
    );

    // pallet-revive rejects an unmapped origin with AccountUnmapped, and a fresh
    // account is always unmapped. This submits a mapping transaction the first
    // time only — which is why it is here, on the write path, and not on load.
    step('preparing your account');
    const mapped = (await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contracts as any).ensureContractAccountMapped(runtime, account.address, signer),
      MAP_MS,
      'account mapping',
    )) as { ok: boolean; error?: unknown } | undefined;
    if (mapped && mapped.ok === false) {
      return { kind: 'error', why: `account mapping failed: ${explain(mapped.error)}` };
    }

    // .tx() dry-runs first, so AlreadyReviewed or NotHuman surfaces as a decoded
    // revert before anything is signed or paid for.
    step('waiting for your signature');
    await withTimeout(contract.review.tx(label, name, rating, body), TX_MS, 'review transaction');

    return { kind: 'onchain' };
  } catch (e) {
    return { kind: 'error', why: explain(e) };
  }
}
