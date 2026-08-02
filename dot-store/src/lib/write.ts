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
 *   1. Inside the Polkadot app, sign through the host — with the reader's OWN
 *      wallet account, best-funded first, falling back to the app-scoped
 *      account only when the shell surfaces no wallet at all.
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
  | { kind: 'local'; why: string; code?: 'no-account' }
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
    const tx: Record<string, string> = {
      from,
      to: APP_REVIEWS,
      data: encodeReview(label, name, rating, body),
    };

    // Ask for an estimate and then quadruple it. The same under-estimation that
    // made every review revert with Revive.OutOfGas on the host path applies
    // here: pallet-revive's EVM layer reports a figure far below what the call
    // actually consumes (29k gas for a call that writes a struct, a string and
    // two array pushes). Unused gas is refunded, so the headroom is free; a
    // short limit is a transaction that is mined and then throws away.
    try {
      const est = (await eth.request({ method: 'eth_estimateGas', params: [tx] })) as string;
      const gas = BigInt(est) * 4n;
      tx.gas = '0x' + gas.toString(16);
    } catch {
      // No estimate available: let the wallet decide rather than invent a cap.
    }

    const hash = (await withTimeout(
      eth.request({ method: 'eth_sendTransaction', params: [tx] }) as Promise<string>,
      TX_MS,
      'review transaction',
    )) as string;

    return { kind: 'onchain', via: 'wallet', hash };
  } catch (e) {
    return { kind: 'error', why: explain(e), step };
  }
}

/* -------------------------------------------------------------------- host */

/**
 * WHOSE ACCOUNT SIGNS, and why it is not a SignerManager any more.
 *
 * The store used to sign through `new SignerManager({ dappName: 'dot-store.dot' })`.
 * That does NOT use the reader's wallet: given a `dappName`, the host provider
 * takes its product-account branch and hands back `getProductAccount('dot-store.dot', 0)`
 * — an APP-SCOPED account the shell derives for this app. It starts empty, it is
 * not visible in the wallet UI, and nobody can fund it without being told it
 * exists. Every review is a paid transaction (a fee, at minimum), so that
 * account is exactly the one that cannot pay: the failures read as
 * `Revive.TransferFailed` or "Inability to pay some fees", and any state the
 * contract keys on the caller would be keyed on an address that is not the
 * reader's. `SignerManager` offers no route to the wallet at all.
 *
 * So the accounts provider is used directly, and the reader's OWN accounts come
 * first (`getLegacyAccounts` + `getLegacyAccountSigner`), choosing the
 * best-funded one when there are several. The app-scoped account stays as a
 * fallback for shells that expose no wallet accounts — it still works when it
 * has a balance, and when it doesn't the failure names the address so it can be
 * topped up instead of reading like a bug.
 */
type SignerKind = 'wallet' | 'app';

interface Slot {
  address: string;
  // The provider's signer is a PAPI PolkadotSigner; the SDK's contract helpers
  // are reached through an untyped bridge below, so this stays deliberately open.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any;
  /** 'wallet' = one of the reader's own accounts; 'app' = the host-derived one. */
  kind: SignerKind;
  name?: string;
}

/** Only a SUCCESSFUL connection is memoised — see getSlot(). */
let slotPromise: Promise<Slot | null> | null = null;

async function connect(): Promise<Slot | null> {
  const [host, papi] = await Promise.all([
    import('@parity/product-sdk-host'),
    import('polkadot-api'),
  ]);

  // The provider's lookups answer with a ResultAsync — thenable, but not a
  // Promise — so every call is wrapped and this boundary is untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: any = await withTimeout(
    host.getAccountsProvider() as unknown as Promise<unknown>,
    CONNECT_MS,
    'accounts provider',
  ).catch(() => null);
  if (!ap) return null;

  // A HostAccount carries `publicKey` bytes and no address at all.
  const ss58 = (pk: Uint8Array) => papi.AccountId().dec(pk) as string;

  // The reader's own accounts first.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(
      Promise.resolve(ap.getLegacyAccounts()),
      ACCOUNT_MS,
      'wallet accounts',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts: any[] = (r?.value ?? []).filter(
      (a: { publicKey?: Uint8Array }) => a?.publicKey,
    );
    if (accounts.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const best = await richest(accounts.map((a: any) => ({ ...a, address: ss58(a.publicKey) })));
      return {
        address: best.address,
        signer: ap.getLegacyAccountSigner({ publicKey: best.publicKey, name: best.name }),
        kind: 'wallet',
        name: best.name,
      };
    }
  } catch {
    // Fall through to the app account rather than giving up on signing.
  }

  // Fallback: the app-scoped account, for shells that surface no wallet.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(
      Promise.resolve(ap.getProductAccount('dot-store.dot', 0)),
      ACCOUNT_MS,
      'app account',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pa: any = r?.value;
    if (pa) {
      const address = pa.address ?? (pa.publicKey ? ss58(pa.publicKey) : null);
      if (address) return { address, signer: ap.getProductAccountSigner(pa), kind: 'app' };
    }
  } catch {
    // No account of either kind — the caller reports 'no-account'.
  }
  return null;
}

/**
 * Of the reader's accounts, the one that can actually pay the fee.
 *
 * Balance reads are best effort and bounded: if they all fail we keep the first
 * account, which is the behaviour a single-account wallet has anyway.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function richest<T extends { address: string } & Record<string, any>>(
  accounts: T[],
): Promise<T> {
  if (accounts.length === 1) return accounts[0];
  try {
    const [papi, descriptors, host] = await Promise.all([
      import('polkadot-api'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      import('@parity/product-sdk-host'),
    ]);
    const genesis = (descriptors.devnet_asset_hub as unknown as { genesis: `0x${string}` }).genesis;
    const provider = await withTimeout(host.getHostProvider(genesis), CONNECT_MS, 'host provider');
    if (!provider) return accounts[0];
    const api = papi.createClient(provider).getTypedApi(descriptors.devnet_asset_hub);
    const weighed = await Promise.all(
      accounts.slice(0, 6).map(async (a) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const acc: any = await withTimeout(
            api.query.System.Account.getValue(a.address),
            10_000,
            'balance',
          );
          return { a, free: BigInt(acc?.data?.free ?? 0) };
        } catch {
          return { a, free: 0n };
        }
      }),
    );
    weighed.sort((x, y) => (y.free > x.free ? 1 : y.free < x.free ? -1 : 0));
    return weighed[0].a;
  } catch {
    return accounts[0];
  }
}

/**
 * The connected account, connected once per session.
 *
 * Only a SUCCESSFUL connection is memoised. Caching a failure would make one
 * bad boot permanent: every later Post would replay the same dead session
 * instead of trying the handshake again.
 */
function getSlot(): Promise<Slot | null> {
  if (!slotPromise) {
    slotPromise = connect().catch(() => null);
    void slotPromise.then((s) => {
      if (!s) slotPromise = null;
    });
  }
  return slotPromise;
}

/**
 * Start connecting before the reader presses anything.
 *
 * Called when someone touches the review form — a clear enough intent to spend
 * the download on, and it buys the handshake the seconds it needs. Fire and
 * forget: every failure here is re-discovered, and reported, on submit.
 */
export function warmUpSigner(): void {
  void getSlot().catch(() => undefined);
}

/**
 * Which account is signing, for anything that wants to show it. `kind: 'app'`
 * means the reader's wallet was not reachable and the shell's app-scoped
 * account is being used instead — an address they can fund, but not one they
 * will recognise.
 */
export async function signerInfo(): Promise<{
  address: string;
  kind: SignerKind;
  name?: string;
} | null> {
  const s = await getSlot().catch(() => null);
  return s ? { address: s.address, kind: s.kind, name: s.name } : null;
}

/**
 * When the app-scoped fallback is the one signing, a payment failure has a
 * remedy the reader cannot guess: fund THAT address. Only appended to failures
 * that are actually about money — an AlreadyReviewed revert does not need it.
 */
function fallbackHint(slot: Slot, why: string): string {
  if (slot.kind !== 'app') return why;
  if (!/balance|funds|fee|TransferFailed|Payment|Deposit|pay/i.test(why)) return why;
  return (
    `${why} — the store is signing with the app account the Polkadot app derived for it ` +
    `(${slot.address}), not your wallet, and it is empty; send it a little PAS and try again`
  );
}

async function postViaHost(args: PostArgs): Promise<PostOutcome> {
  const { label, name, rating, body, onStep } = args;
  let step = 'starting';
  // Hoisted so a throw anywhere below can still say which account was signing.
  let slot: Slot | null = null;
  try {
    const [host, contracts, descriptors, papi] = await Promise.all([
      import('@parity/product-sdk-host'),
      import('@parity/product-sdk/contracts'),
      import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      import('polkadot-api'),
    ]);

    step = 'connecting your account';
    onStep?.(step);
    slot = await getSlot();
    if (!slot) {
      // Observed in the web shell, and NOT specific to this app: the host logs
      // "failed to get product account … RangeError: Offset is outside the
      // bounds of the DataView" and resolves with an empty account list. The
      // Button, which has signed successfully before, fails identically there.
      //
      // So this is the shell being unable to derive an account, not the reader
      // having forgotten to connect one — and telling them to go and connect a
      // wallet would send them hunting for a setting that does not exist.
      return {
        kind: 'local',
        code: 'no-account',
        why: 'the shell could not derive an account for this app',
      };
    }

    const signer = slot.signer;
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
    // `{ signer }`, NOT `{ signerManager }`: the manager would re-derive the
    // app-scoped account internally and undo the choice made in connect().
    const contract = (contracts as any).createContract(runtime, APP_REVIEWS, APP_REVIEWS_ABI, {
      signer,
    });

    // pallet-revive rejects an unmapped origin with AccountUnmapped, and a fresh
    // account is always unmapped. This submits a mapping transaction the first
    // time only — which is why it is here, on the write path, and not on load.
    step = 'preparing your account';
    onStep?.(step);
    const mapped = (await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contracts as any).ensureContractAccountMapped(runtime, slot.address, signer),
      MAP_MS,
      'account mapping',
    )) as { ok: boolean; error?: unknown } | undefined;
    if (mapped && mapped.ok === false) {
      return { kind: 'error', why: fallbackHint(slot, explain(mapped.error)), step };
    }

    step = 'waiting for your signature';
    onStep?.(step);
    // EXPLICIT LIMITS, and this is the whole reason reviews never landed.
    //
    // `.tx()` normally sizes the call with its own dry-run and submits with
    // whatever that returns. For this contract the estimate came back short,
    // and every review was included in a block and then reverted with
    // `Revive.OutOfGas` — a failure that leaves no trace a reader could see and
    // no log the contract could emit, which is why the store kept reporting
    // nothing while the chain kept holding nothing. Reproduced outside the app
    // against the same contract with the same SDK: OutOfGas every time with the
    // dry-run, and a review in block 11594035 the moment these limits were
    // passed instead.
    //
    // Passing both also skips the dry-run entirely, per the SDK's own contract.
    // The numbers are deliberately generous — 0.6s of ref_time and 1 MB of
    // proof size for one storage write — because unused weight is not charged,
    // and the storage deposit is reserved and refunded, not spent. Being
    // stingy here costs a failed transaction; being generous costs nothing.
    const result = (await withTimeout(
      contract.review.tx(label, name, rating, body, {
        gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
        storageDepositLimit: 10n ** 18n,
      }),
      TX_MS,
      'review transaction',
    )) as { ok?: boolean; error?: unknown } | undefined;

    // .tx() reports dispatch failures in its RESULT, not by throwing. Reading
    // only the throw is how OutOfGas passed for success in the first place.
    if (result && result.ok === false) {
      return { kind: 'error', why: fallbackHint(slot, explain(result.error)), step };
    }

    return { kind: 'onchain', via: 'host' };
  } catch (e) {
    const why = explain(e);
    return { kind: 'error', why: slot ? fallbackHint(slot, why) : why, step };
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
