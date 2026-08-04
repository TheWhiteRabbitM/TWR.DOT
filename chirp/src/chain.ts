/**
 * Chirp's chain layer: the timeline, and everything you can do to a post.
 *
 * Two contracts on the devnet Asset Hub, nothing else — no server, no Bulletin,
 * so a chirp cannot expire or be taken down by anyone but its author.
 *
 * IDENTITY. You post AS a mask. PeoplebookMasks2 binds one mask to one account
 * and refuses transfers, so `ownerOf(mask) == caller` means a post can only come
 * from the account that mask belongs to: nothing to squat, nothing to buy. The
 * display name is yours to choose (like the name on X); the tick is reserved for
 * a `.dot` the contract itself checked against the registry.
 *
 * ONE IDENTITY, ONE APP NAME. The host derives a different account per app name,
 * so every app in this ecosystem must ask for the SAME one or the same person
 * ends up as two. That string is IDENTITY_DAPP — changing it changes who you are.
 */
import { keccak_256 } from '@noble/hashes/sha3';
import MASKS_ABI from './masks-abi.json';
import CHIRP_ABI from './chirp-abi.json';
import HANDLES_ABI from './handles-abi.json';
import NOTES_ABI from './notes-abi.json';
import PFP_ABI from './pfp-abi.json';
import FACE_ABI from './face-abi.json';

export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
export const CHIRP = '0x37A7CE834428636815b2746408343574aD13be7C';
/** The @name registry. Separate from the masks contract because identity gained
 *  this field after masks and chirps already held content. */
export const HANDLES = '0x7C61D99564C61e667C6Fd5D41aC2466327ea4109';
/** Context on a chirp, and the ratings that decide whether it is shown. */
export const NOTES = '0xf3584d1b59fb8759f4c6572e3a13c8a7af79c0cc';
/** Profile pictures — the KEY to one, on Bulletin. Same reason as HANDLES: the
 *  masks contract is deployed and its profile struct cannot grow. */
export const PFP = '0x6f3f9d84161f0bd0eb9d6524a5a2e5089b565470';
/**
 * The picture ITSELF, on Asset Hub.
 *
 * PeoplePFP kept a key and left the image on Bulletin. It came back only on the
 * device that set it — clear the browser and the face was gone, which means it
 * was never really on chain, it was in a cache with a receipt on chain. The
 * bytes live here instead: a couple of kilobytes, paid once as a deposit, no
 * expiry, no host service, and the same for every reader.
 */
export const FACE = '0xbc11688b1421bdde1fa1be5ea5bf02e9bb49be03';
const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';
const IDENTITY_DAPP = 'peoplebook.dot';

/**
 * The only outside hosts chirp will load anything from.
 *
 * A GIF chosen from a phone keyboard is pasted as a link, so it costs nothing on
 * chain and nothing on Bulletin — but rendering it fetches from somebody else's
 * server, and that server then knows a reader's IP and roughly when they read.
 * Hence a fixed list rather than "any image URL": the trade is worth making for
 * the two services keyboards actually use, and not worth making for the web.
 */
export const GIF_HOSTS = ['media.tenor.com', 'tenor.com', 'media.giphy.com', 'i.giphy.com', 'giphy.com'];
/** Declared alongside them so the public reader has a chance of connecting from
 *  inside the container too. It is not relied on — see handles(). */
const RPC_HOSTS = ['asset-hub-paseo-rpc.n.dwellir.com', 'paseo-assethub-rpc.laissez-faire.trade'];
/**
 * Fetch a GIF and hand back a local blob URL.
 *
 * Pointing an `<img src>` at a remote host does not work inside the container:
 * the page's own image policy blocks it before any permission is consulted, so
 * the tag stays empty and the chirp looks like it lost its picture. The chat
 * SDK gets away with a bare URL because the HOST renders it, outside this
 * sandbox — that method does not transfer to an app drawing its own timeline.
 *
 * What does transfer: `fetch`, which is exactly what the Remote permission
 * grants. Fetch the bytes, wrap them in a blob URL, and point the tag at that —
 * now same-origin, and nothing is blocked. If the fetch is refused, the caller
 * shows a link instead of a broken frame.
 */
const gifCache = new Map<string, string>();
export async function gifBlob(url: string): Promise<string> {
  const hit = gifCache.get(url);
  if (hit !== undefined) return hit;

  // Two attempts, cheapest first. A plain CORS fetch is what the Remote
  // permission grants; `no-cors` gets an opaque response whose bytes we cannot
  // read, so it is not worth trying. If CORS is refused, an <img> tag is still
  // worth one go — image loading and fetch are governed by DIFFERENT policies,
  // and which of the two a container blocks is not something to assume.
  try {
    const r = await fetch(url, { referrerPolicy: 'no-referrer', mode: 'cors' });
    if (r.ok) {
      const local = URL.createObjectURL(await r.blob());
      gifCache.set(url, local);
      return local;
    }
  } catch { /* fall through to the tag */ }

  const direct = await new Promise<string>((res) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const done = (v: string) => res(v);
    img.onload = () => done(url);       // it renders: use the URL as-is
    img.onerror = () => done('');
    setTimeout(() => done(''), 6000);
    img.src = url;
  });
  gifCache.set(url, direct);            // remember either answer; do not re-ask per render
  return direct;
}

/** Is this a link a keyboard would have inserted for a GIF? */
export function gifUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (!GIF_HOSTS.includes(h)) return false;
    return /\.(gif|webp|mp4)($|\?)/i.test(u) || /\/media\//.test(u) || h.startsWith('media.');
  } catch { return false; }
}

const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const TX_MS = 120_000;
/** Explicit limits skip the SDK's sizing dry-run, whose estimate comes back short
 *  and reverts OutOfGas before the wallet is ever asked. Unused weight is free. */
const LIMITS = {
  gasLimit: { ref_time: 600_000_000_000n, proof_size: 1_000_000n },
  storageDepositLimit: 10n ** 18n,
};

export type Post = {
  id: number;
  mask: number;
  author: string;
  time: number;
  edited: number;
  replyTo: number;
  quoteOf: number;
  deleted: boolean;
  likes: number;
  replies: number;
  reposts: number;
  body: string;
  /** Filled in for rendering: the identity behind `mask`. */
  who?: Who;
  /** The quoted post, when this is a quote or a repost. */
  quoted?: Post;
  liked?: boolean;
  reposted?: boolean;
};

export type Who = {
  mask: number;
  name: string;
  /** A .dot the CONTRACT checked against the registry — the only thing that
   *  earns a tick. */
  verified: string;
  /** The People chain username this mask goes by. Unique across masks and only
   *  settable by the holder, but NOT proof of anything: Asset Hub cannot read
   *  the People chain, so nobody can check it here. Shown without a tick. */
  handle: string;
  tier: number;
};
export type Me = Who & { address: string; kind: 'wallet' | 'app'; telegram: string; x: string; bio: string };
export type Fail = { ok: false; why: string };
export type Ok<T = void> = { ok: true; value: T };

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);
}

/** pallet-revive maps an account to keccak256(public key)'s last 20 bytes.
 *  Contract mappings are keyed by THAT, never by the ss58 the wallet reports. */
async function h160Of(ss58: string): Promise<string> {
  const papi = await import('polkadot-api');
  return '0x' + Array.from(keccak_256(papi.AccountId().enc(ss58)).slice(12, 32), (b) => b.toString(16).padStart(2, '0')).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reason(res: any): string {
  const e = res?.error ?? res;
  let d = '';
  try {
    d = [e?.message, e?.name, typeof e?.dispatchError === 'string' ? e.dispatchError : JSON.stringify(e?.dispatchError ?? '')]
      .filter(Boolean).join(' | ');
  } catch { d = String(e); }
  if (/SigningRejected|rejected|cancel/i.test(d)) return 'You cancelled the signature.';
  if (/Timeout/i.test(d)) return 'Timed out waiting for the block — it may still land.';
  if (/Inability to pay|TransferFailed/i.test(d)) return 'The signing account cannot pay the fee.';
  // Naming the call is useless to the person holding the phone; what they need
  // to know is that this build of the app cannot sign with a wallet account.
  if (/Not implemented|createTransactionWithLegacyAccount/i.test(d)) {
    return 'This build of the Polkadot app cannot sign with your wallet account. chirp will use the account the app derives for it instead — try again.';
  }
  // Custom Solidity errors are not decoded on this path — the chain says only
  // that the call reverted, so name what this app can actually hit.
  if (/ContractReverted/i.test(d)) return 'The contract refused it — the post may be deleted, or not yours to change.';
  return d.slice(0, 150) || 'The chain refused it.';
}

/* ------------------------------------------------------------------ session */

type Slot = {
  address: string;
  h160: string;
  kind: 'wallet' | 'app';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any; manager?: any; masks: any; chirp: any; handles: any; notes: any; pfp: any; face: any;
  /** The typed api, needed to wrap a contract call in Proxy.proxy. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any;
  /**
   * The account this session acts FOR, when the signer has been made its proxy.
   *
   * The host signs with an account it derives per app, which is nobody in
   * particular. If the person adds that account as a proxy of their real one,
   * every call can be sent through Proxy.proxy and the contract sees the REAL
   * account as msg.sender — verified on chain: a delegate successfully called a
   * function gated on `ownerOf(mask) == msg.sender` for a mask it does not own.
   * That makes the mask belong to the same AccountId32 that owns the People
   * username, which is what finally connects the two.
   */
  real: string | null;
};
let slot: Promise<Slot | null> | null = null;

/**
 * Set when the host hands us a legacy account it cannot actually sign with.
 *
 * Some builds expose getLegacyAccounts() and getLegacyAccountSigner() and then
 * answer every submission with
 *   createTransactionWithLegacyAccount failed: HostFailure: Not implemented
 * A signer exists, so "no signer, fall back" never fired — the app looked
 * connected and failed at the first write, every time. Once seen, we stop
 * asking for the wallet account and take the app-derived one instead, and the
 * choice is remembered so the next launch does not repeat the dead end.
 */
const NOLEGACY = 'chirp.nolegacy';
const legacyBroken = {
  get: () => { try { return localStorage.getItem(NOLEGACY) === '1'; } catch { return false; } },
  set: () => { try { localStorage.setItem(NOLEGACY, '1'); } catch { /* private mode */ } },
};

/**
 * Sign from a browser, with a wallet extension, when there is no host at all.
 *
 * Opened through the gateway rather than the Polkadot app, chirp has nobody to
 * ask who you are — the timeline reads fine and every button is dead, which is
 * a shop window, not an app. A browser extension closes that: it signs against
 * Asset Hub directly.
 *
 * And it is the SAME person. A mask is bound to an AccountId, and the contract
 * is keyed by that account's H160 — so the extension holding the account that
 * claimed the mask reaches exactly the same identity the app reaches. Nothing
 * is duplicated, nothing has to be linked.
 *
 * What it cannot do: preimages and notifications, which are host services with
 * no chain equivalent. So a picture cannot be set from here. The rest can.
 *
 * Never used inside the container — in there the host is the only right answer,
 * and asking an extension to sign would create a second identity for no reason.
 */
async function browserSlot(): Promise<Slot | null> {
  const [papi, pjs, contracts, descriptors] = await Promise.all([
    import('polkadot-api'),
    import('@polkadot-api/pjs-signer'),
    import('@parity/product-sdk/contracts'),
    import('@parity/product-sdk-descriptors/devnet-asset-hub'),
  ]);
  const names = pjs.getInjectedExtensions();
  if (!names.length) return null;                    // no extension: read-only
  const ext = await pjs.connectInjectedExtension(names[0], 'chirp').catch(() => null);
  if (!ext) return null;
  const accounts = ext.getAccounts();
  if (!accounts.length) return null;                 // extension present, nothing shared
  const acc = accounts[0];

  const ws = await import('polkadot-api/ws');
  const client = papi.createClient(ws.getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
  const address = acc.address;
  const signer = acc.polkadotSigner;
  await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(runtime, address, signer), 30_000, 'mapping',
  ).catch(() => undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = (addr: string, abi: unknown) => (contracts as any).createContract(runtime, addr, abi, { defaultSigner: signer, defaultOrigin: address });
  const api = client.getTypedApi(descriptors.devnet_asset_hub);
  const real = await proxiedAccount(api, address);
  return {
    address, h160: await h160Of(real ?? address), kind: 'wallet', signer, api, real,
    masks: mk(MASKS, MASKS_ABI), chirp: mk(CHIRP, CHIRP_ABI), handles: mk(HANDLES, HANDLES_ABI),
    notes: mk(NOTES, NOTES_ABI), pfp: mk(PFP, PFP_ABI), face: mk(FACE, FACE_ABI),
  };
}

async function connect(): Promise<Slot | null> {
  const [host, papi, contracts, descriptors] = await Promise.all([
    import('@parity/product-sdk-host'),
    import('polkadot-api'),
    import('@parity/product-sdk/contracts'),
    import('@parity/product-sdk-descriptors/devnet-asset-hub'),
  ]);
  if (!(await host.isInsideContainer().catch(() => false))) return browserSlot().catch(() => null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: any = await withTimeout(host.getAccountsProvider() as any, CONNECT_MS, 'wallet').catch(() => null);
  if (!ap) return null;
  // Without this the host never raises a signing sheet and a write hangs silently.
  await withTimeout(Promise.resolve(host.requestPermission({ tag: 'ChainSubmit', value: undefined })), CONNECT_MS, 'permission')
    .catch(() => undefined);
  // And this one is its exact twin for preimages: without PreimageSubmit the
  // host refuses remote_preimage_submit, so a picture upload cannot even begin.
  // Asked here rather than at upload time so the person is not interrupted by a
  // second permission sheet in the middle of choosing a photo.
  await withTimeout(Promise.resolve(host.requestPermission({ tag: 'PreimageSubmit', value: undefined })), CONNECT_MS, 'preimage permission')
    .catch(() => undefined);
  // Outbound access, only for the hosts phone keyboards insert GIFs from. A GIF
  // picked from the keyboard arrives as a LINK, so it costs nothing on Bulletin
  // — but showing it means fetching from a third party, which the container
  // blocks unless the domains are declared. Nothing else is listed: this is the
  // whole outside world chirp can reach.
  await withTimeout(Promise.resolve(host.requestPermission({ tag: 'Remote', value: { domains: [...GIF_HOSTS, ...RPC_HOSTS] } })), CONNECT_MS, 'remote permission')
    .catch(() => undefined);

  const ss58 = (pk: Uint8Array) => papi.AccountId().dec(pk) as string;
  let address = '';
  let kind: 'wallet' | 'app' = 'wallet';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: any = null;

  if (!legacyBroken.get()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await withTimeout(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (r?.value ?? []).find((x: any) => x?.publicKey);
      if (a) { address = ss58(a.publicKey); signer = ap.getLegacyAccountSigner({ publicKey: a.publicKey, name: a.name }); }
    } catch { /* fall through */ }
  }

  // Fallback: SignerManager on the app-scoped account. NOT getProductAccountSigner —
  // that signer never raises the wallet sheet, so a write hangs until it times out.
  if (!signer) {
    try {
      const signerPkg = await import('@parity/product-sdk-signer');
      manager = new signerPkg.SignerManager({ dappName: IDENTITY_DAPP });
      await withTimeout(manager.connect(), CONNECT_MS, 'wallet').catch(() => undefined);
      const deadline = Date.now() + ACCOUNT_MS;
      for (;;) {
        const st = manager.getState();
        let acc = st.selectedAccount ?? null;
        if (!acc && st.accounts[0]) {
          const picked = manager.selectAccount(st.accounts[0].address);
          if (picked.ok) acc = picked.value;
        }
        if (acc) { address = acc.address; signer = manager.getSigner(); kind = 'app'; break; }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { /* none */ }
  }
  if (!signer || !address) return null;

  const provider = await withTimeout(host.getHostProvider(GENESIS as `0x${string}`), CONNECT_MS, 'chain');
  if (!provider) return null;
  const client = papi.createClient(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
  await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(runtime, address, signer), 30_000, 'mapping',
  ).catch(() => undefined);

  // `signer` is not a ContractOptions key — it is silently dropped. The real
  // names are signerManager / defaultSigner / defaultOrigin.
  const opts = manager ? { signerManager: manager, defaultOrigin: address } : { defaultSigner: signer, defaultOrigin: address };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = (addr: string, abi: unknown) => (contracts as any).createContract(runtime, addr, abi, opts);
  const api = client.getTypedApi(descriptors.devnet_asset_hub);
  const real = await proxiedAccount(api, address);
  // Identity is read for whoever we act as, so a mask claimed through the proxy
  // is found again.
  const who = real ?? address;
  return {
    address, h160: await h160Of(who), kind, signer, manager, api, real,
    masks: mk(MASKS, MASKS_ABI), chirp: mk(CHIRP, CHIRP_ABI), handles: mk(HANDLES, HANDLES_ABI),
    notes: mk(NOTES, NOTES_ABI), pfp: mk(PFP, PFP_ABI), face: mk(FACE, FACE_ABI),
  };
}

/**
 * Find the account our signer has been made a proxy of, if any.
 *
 * The Proxy pallet is keyed the other way — real -> delegates — so there is no
 * direct lookup and the map has to be scanned. It is a few hundred rows on this
 * chain, read once per session. Ambiguity is resolved by taking none: if the
 * signer can act for more than one account, guessing which one you meant would
 * be worse than staying yourself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function proxiedAccount(api: any, delegate: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await withTimeout(api.query.Proxy.Proxies.getEntries(), 15_000, 'proxies');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = rows.filter((e: any) => (e?.value?.[0] ?? []).some((d: any) => String(d?.delegate) === delegate));
    return mine.length === 1 ? String(mine[0]?.keyArgs?.[0] ?? '') || null : null;
  } catch {
    return null;
  }
}

/** Who the app is acting as, for the UI to say so plainly. */
export async function actingAs(): Promise<{ signer: string; real: string | null } | null> {
  const s = await session().catch(() => null);
  return s ? { signer: s.address, real: s.real } : null;
}

function session(): Promise<Slot | null> {
  if (!slot) {
    slot = connect().catch(() => null);
    void slot.then((s) => {
      if (!s) { slot = null; return; }   // never memoise a failure
      ready = s;                          // reads can stop using the public RPC
    });
  }
  return slot;
}
/**
 * Start both connections at once, as early as anything can.
 *
 * Measured: the same read of twenty-five chirps takes 8678ms the first time,
 * 924ms the second and 198ms the third. Almost none of that is the reads — it
 * is a one-off cost paid on the first use of a client: the websocket, and the
 * runtime metadata. Batching, caching and parallelism were all attacking the
 * cheap part.
 *
 * So the public reader is opened as early as anything can open it, in parallel
 * with the host handshake. Neither blocks the other and neither blocks paint.
 *
 * On a microtask, NOT inline: `pub` closes over a `let` declared further down
 * this file, so calling it while the module body is still running hits the
 * temporal dead zone and throws — which took the whole module with it and left
 * an empty page with nothing in the console.
 */
queueMicrotask(() => { void pub(); });

export function warmUp(): void { void session(); void pub(); }

/* ------------------------------------------------------------ notifications */
// The host owns the notification surface — the OS permission and the delivery
// both. We ask for the permission only when the person has asked to be told,
// never on load: a prompt nobody invited is the reason these get denied.

/**
 * Ask for everything a picture might need, and report what was granted.
 *
 * A photo picker in a container is not one permission but a chain of them, and
 * which link is missing is invisible from in here: the tap simply does nothing.
 * So ask for all of them, and hand the caller the answers so the UI can say
 * which one was refused instead of showing a dead button.
 */
export async function pictureRights(): Promise<Record<string, boolean>> {
  const host = await import('@parity/product-sdk-host').catch(() => null);
  if (!host) return {};
  const out: Record<string, boolean> = {};
  for (const k of ['Camera', 'Clipboard'] as const) {
    const r = await host.requestDevicePermission(k).catch(() => null);
    out[k] = Boolean(r && (r as any).ok && (r as any).value);
  }
  const p = await host.requestPermission({ tag: 'PreimageSubmit', value: undefined }).catch(() => null);
  out.PreimageSubmit = Boolean(p && (p as any).ok && (p as any).value);
  return out;
}

/** Ask the host for the Notifications permission. False if refused, or if the
 *  app is running outside the host (a browser tab has no such surface). */
export async function askNotifications(): Promise<boolean> {
  const host = await import('@parity/product-sdk-host').catch(() => null);
  if (!host) return false;
  const r = await host.requestDevicePermission('Notifications').catch(() => null);
  // The host answers with a Result, and a granted:false is a no, not an error.
  return Boolean(r && (r as any).ok && (r as any).value);
}

/**
 * Open a link.
 *
 * Inside the Polkadot app an ordinary anchor with target="_blank" does nothing
 * at all — the container has no second window to open, so the tap is swallowed
 * and the link looks broken. The host resolves destinations itself through
 * navigateTo: an https:// URL opens outside, and a .dot address routes to
 * another app inside the container. Outside the host we fall back to the
 * browser, so the same code works in a plain tab.
 */
export async function openUrl(url: string): Promise<boolean> {
  const host = await import('@parity/product-sdk-host').catch(() => null);
  if (host) {
    // navigateTo can hang rather than answer, so it is raced: a link that has
    // not opened in three seconds has not opened.
    const r = await withTimeout(Promise.resolve(host.navigateTo(url)), 3000, 'navigate').catch(() => null);
    if (r && (r as { ok?: boolean }).ok !== false) return true;
  }
  // Outside the container this is the whole story. Inside it, popups are
  // blocked, so this returns a window that is instantly null.
  try {
    const w = window.open(url, '_blank', 'noopener');
    if (w) return true;
  } catch { /* blocked */ }
  // Last resort: put it on the clipboard, so the person has the address rather
  // than a tap that did nothing. The caller shows it too — silence is the one
  // outcome that leaves somebody stuck.
  try { await navigator.clipboard.writeText(url); } catch { /* no clipboard either */ }
  return false;
}

/** Deliver one notification now. Silent when the host has no manager for it. */
export async function notify(text: string, deeplink?: string): Promise<boolean> {
  const host = await import('@parity/product-sdk-host').catch(() => null);
  if (!host) return false;
  const mgr = await host.getNotificationManager().catch(() => null);
  if (!mgr) return false;
  return await mgr.push({ text, deeplink }).then(() => true).catch(() => false);
}

/* ---------------------------------------------------------------- pictures */
//
// The image is NOT on Asset Hub. It goes to Bulletin as a preimage through the
// host, and PeoplePFP stores only the key the host hands back. Two reasons: the
// bytes would otherwise be a storage deposit paid by every person who sets one,
// and the Bulletin storage pool a publisher draws from needs an authorisation an
// ordinary user cannot obtain — the host's preimage surface is the only upload
// path they actually have.
//
// Bulletin keeps data for roughly a fortnight, so a picture left alone expires.
// A preimage is content-addressed, so re-submitting identical bytes returns an
// identical key: renewal is a read followed by a write of the SAME bytes, which
// costs no transaction and never touches the contract. See renewPfp.

/** Resolved pictures, so a timeline showing one person forty times fetches once. */
const pfpCache = new Map<number, string>();
/** Masks already looked up and found to have none — otherwise every render
 *  re-asks the chain about the same absence. */
const noPfp = new Set<number>();

async function preimages() {
  const host = await import('@parity/product-sdk-host').catch(() => null);
  return host ? await host.getPreimageManager().catch(() => null) : null;
}

/** The host delivers preimage bytes through a subscription that reports `null`
 *  until it finds them, so this waits — but not forever: a picture that is not
 *  coming must not hold a face blank on the page. */
function fetchPreimage(key: string, ms = 10_000): Promise<Uint8Array | null> {
  return new Promise(async (resolve) => {
    const mgr = await preimages();
    if (!mgr) return resolve(null);
    let done = false;
    const finish = (v: Uint8Array | null) => { if (!done) { done = true; try { sub?.unsubscribe(); } catch { /* gone */ } resolve(v); } };
    const timer = setTimeout(() => finish(null), ms);
    let sub: { unsubscribe(): void } | undefined;
    try {
      sub = mgr.lookup(key as `0x${string}`, (bytes) => { if (bytes) { clearTimeout(timer); finish(bytes); } });
    } catch { clearTimeout(timer); finish(null); }
  });
}

/** The picture for a mask as a data URL, or '' when it has none — or when the
 *  bytes have expired, which is deliberately the same answer: the caller draws
 *  the generated avatar either way. */
export async function pictureOf(mask: number): Promise<string> {
  const hit = pfpCache.get(mask);
  if (hit !== undefined) return hit;
  if (noPfp.has(mask)) return '';

  // The picture itself, straight off Asset Hub. No key, no Bulletin, no host
  // service and no cache: whatever is stored is what every reader sees, and it
  // is still there after the browser is wiped.
  const { face } = await handles();
  const bytesHex = face ? await q(face, 'faceOf', BigInt(mask)) : undefined;
  const hex = typeof bytesHex === 'string' ? bytesHex : (bytesHex as { asHex?: () => string })?.asHex?.() ?? '';
  if (hex && hex !== '0x') {
    const url = 'data:image/webp;base64,' + btoa(
      (hex.slice(2).match(/../g) ?? []).map((b) => String.fromCharCode(parseInt(b, 16))).join(''),
    );
    pfpCache.set(mask, url);
    return url;
  }

  // Nothing here yet: fall back to the older key-on-Bulletin picture, so people
  // who set one before this changed do not lose their face on the way over.
  const { pfp } = await handles();
  const raw = pfp ? await q(pfp, 'pfpOf', BigInt(mask)) : undefined;
  const key = typeof raw === 'string' ? raw : (raw as { asHex?: () => string })?.asHex?.() ?? '';
  if (!key || key === '0x') { noPfp.add(mask); return ''; }
  // The stored bytes ARE the key; hand them back as the hex the host expects.
  const bytes = await fetchPreimage(key.startsWith('0x') ? key : '0x' + key);
  if (!bytes) { noPfp.add(mask); return ''; }
  const url = 'data:image/webp;base64,' + btoa(String.fromCharCode(...bytes));
  pfpCache.set(mask, url);
  return url;
}

export function forgetPicture(mask?: number) {
  if (mask) { pfpCache.delete(mask); noPfp.delete(mask); } else { pfpCache.clear(); noPfp.clear(); }
}

/** The most the picture contract will take. */
export const FACE_MAX = 12_000;

/**
 * Put the picture on chain.
 *
 * One transaction, no upload service, nothing to renew. The bytes go into
 * PeopleFace and that is the whole story — which is the point: the previous
 * arrangement kept a key here and the image on Bulletin, and the image came
 * back only on the device that had set it.
 */
export async function setPicture(mask: number, bytes: Uint8Array): Promise<Ok | Fail> {
  if (!bytes.length) return { ok: false, why: 'That produced no image data.' };
  if (bytes.length > FACE_MAX) {
    return { ok: false, why: `That is ${bytes.length} bytes and the limit is ${FACE_MAX}. Try a simpler picture.` };
  }
  const hex = '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const r = await send('face', 'setFace', [BigInt(mask), hex]);
  if (r.ok) {
    pfpCache.set(mask, 'data:image/webp;base64,' + btoa(String.fromCharCode(...bytes)));
    noPfp.delete(mask);
  }
  return r;
}

export function clearPicture(mask: number): Promise<Ok | Fail> {
  pfpCache.delete(mask); noPfp.add(mask);
  return send('face', 'clear', [BigInt(mask)]);
}

/** Renew a picture that still lives on Bulletin under the OLD arrangement.
 *
 *  Only those need it — a picture in PeopleFace cannot expire. Kept so nobody
 *  who set one before the change loses their face while they have not replaced
 *  it. Content-addressed, so re-submitting identical bytes gives an identical
 *  key and no transaction is needed. */
export async function renewPicture(mask: number): Promise<boolean> {
  if (!mask) return false;
  const { pfp } = await handles();
  const raw = pfp ? await q(pfp, 'pfpOf', BigInt(mask)) : undefined;
  const key = typeof raw === 'string' ? raw : (raw as { asHex?: () => string })?.asHex?.() ?? '';
  if (!key || key === '0x') return false;
  // The stored bytes ARE the key; hand them back as the hex the host expects.
  const bytes = await fetchPreimage(key.startsWith('0x') ? key : '0x' + key);
  if (!bytes) return false;                       // already gone; nothing to renew
  const mgr = await preimages();
  if (!mgr) return false;
  return await mgr.submit(bytes).then(() => true).catch(() => false);
}

/* -------------------------------------------------------------------- reads */

/** A signer-less handle over the public RPC, so the timeline is readable without
 *  a wallet. A social nobody can read unless they sign in is not much of one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reader: Promise<{ chirp: any; masks: any; handles: any; notes: any; pfp: any; face: any } | null> | null = null;
function pub() {
  if (!reader) {
    reader = (async () => {
      const [papi, ws, contracts, descriptors] = await Promise.all([
        import('polkadot-api'), import('polkadot-api/ws'),
        import('@parity/product-sdk/contracts'),
        import('@parity/product-sdk-descriptors/devnet-asset-hub'),
      ]);
      const client = papi.createClient(ws.getWsProvider('wss://asset-hub-paseo-rpc.n.dwellir.com'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rt = (contracts as any).createContractRuntimeFromClient(client, descriptors.devnet_asset_hub);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mk = (a: string, abi: unknown) => (contracts as any).createContract(rt, a, abi);
      return {
        chirp: mk(CHIRP, CHIRP_ABI), masks: mk(MASKS, MASKS_ABI), handles: mk(HANDLES, HANDLES_ABI),
        notes: mk(NOTES, NOTES_ABI), pfp: mk(PFP, PFP_ABI), face: mk(FACE, FACE_ABI),
      };
    })().catch(() => null);
    void reader.then((r) => { if (!r) reader = null; });
  }
  return reader;
}

/**
 * Contract handles for READING.
 *
 * It deliberately does NOT wait for the host. Connecting takes six to ten
 * seconds — the wallet handshake, the permission sheets, a full scan of the
 * proxy map — and none of that is needed to read a public chain. Waiting for it
 * meant the timeline could not start loading until the slowest part of the app
 * had finished, which is most of why opening chirp felt like it had hung.
 *
 * So: if the session is already up, use it (its reads carry your account, so
 * `liked` and `reposted` come back filled in). If it is not, read over the
 * public RPC right now and let the session finish in the background; the next
 * refresh has it. The cost is that the very first paint may not know what you
 * liked, which is a far smaller sin than a blank screen for ten seconds.
 */
let ready: Slot | null = null;

/**
 * Are we inside the Polkadot app? Answered once and remembered, because the
 * answer decides which of the two readers is even possible.
 */
let inside: Promise<boolean> | null = null;
function insideHost(): Promise<boolean> {
  if (!inside) {
    inside = import('@parity/product-sdk-host')
      .then((h) => h.isInsideContainer().catch(() => false))
      .catch(() => false);
  }
  return inside;
}

async function handles() {
  if (ready) return { chirp: ready.chirp, masks: ready.masks, handles: ready.handles, notes: ready.notes, pfp: ready.pfp, face: ready.face, me: ready.h160 };

  // INSIDE the container, wait for the session — do not fall back to the public
  // reader. That reader opens a websocket to a public RPC host, and the
  // container only permits the domains this app declared, which are the GIF
  // hosts and nothing else. So the fallback could never connect: the feed
  // stayed empty until something else forced a refresh AFTER the session had
  // come up, which is exactly the "nothing shows until you open your profile"
  // everyone was seeing. The speed win still holds — the session is started at
  // import, so this waits on something already in flight.
  if (await insideHost()) {
    const s = await session().catch(() => null);
    if (s) return { chirp: s.chirp, masks: s.masks, handles: s.handles, notes: s.notes, pfp: s.pfp, face: s.face, me: s.h160 };
    return { chirp: null, masks: null, handles: null, notes: null, pfp: null, face: null, me: '' };
  }

  void session();   // outside: keep it warming, but do not wait on it
  const p = await pub();
  return { ...(p ?? { chirp: null, masks: null, handles: null, notes: null, pfp: null, face: null }), me: '' };
}

/** Handles for reads that are meaningless without an account — following, and
 *  anything keyed by who you are. These do wait. */
async function myHandles() {
  const s = await session().catch(() => null);
  return s ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = async (c: any, m: string, ...a: unknown[]) => { try { return (await c?.[m]?.query(...a))?.value; } catch { return undefined; } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pick = (v: any, key: string, i: number) => (Array.isArray(v) ? v[i] : v?.[key]);

/** The identity behind a mask, cached — a timeline hits the same few masks over
 *  and over and each lookup is two chain reads. */
const whoCache = new Map<number, Who>();
/** In-flight lookups, so twenty-five chirps by the same author cause ONE set of
 *  reads rather than twenty-five identical ones racing each other. The cache
 *  alone did not help: within a batch none of them had returned yet. */
const whoPending = new Map<number, Promise<Who>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function whoOf(masks: any, mask: number, handlesC?: any): Promise<Who> {
  const hit = whoCache.get(mask);
  if (hit) return Promise.resolve(hit);
  const flight = whoPending.get(mask);
  if (flight) return flight;                 // already asking; wait on that one

  const p = (async () => {
    const hc = handlesC ?? (await handles()).handles;
    const [v, t, pr, h] = await Promise.all([
      q(masks, 'verifiedName', BigInt(mask)),
      q(masks, 'tierOf', BigInt(mask)),
      q(masks, 'profileOf', BigInt(mask)),
      hc ? q(hc, 'handleOf', BigInt(mask)) : Promise.resolve(undefined),
    ]);
    const who: Who = {
      mask,
      name: String(pick(pr, 'displayName', 0) ?? ''),
      verified: String(v ?? ''),
      handle: String(h ?? ''),
      tier: Number(t ?? 4),
    };
    whoCache.set(mask, who);
    return who;
  })();
  whoPending.set(mask, p);
  void p.finally(() => whoPending.delete(mask));
  return p;
}
export function forgetWho(mask?: number) { if (mask) whoCache.delete(mask); else whoCache.clear(); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readPost(chirp: any, masks: any, me: string, id: number, depth = 1): Promise<Post | null> {
  // meta, body and the two "did I" flags do not depend on each other, so they go
  // out together: a post used to cost four sequential round-trips.
  const [m, bodyText, likedFlag, repostFlag] = await Promise.all([
    q(chirp, 'meta', BigInt(id)),
    q(chirp, 'body', BigInt(id)),
    me ? q(chirp, 'liked', BigInt(id), me) : Promise.resolve(undefined),
    me ? q(chirp, 'repostOf', BigInt(id), me) : Promise.resolve(undefined),
  ]);
  if (!m) return null;
  const post: Post = {
    id,
    mask: Number(pick(m, 'mask', 0) ?? 0),
    author: String(pick(m, 'author', 1) ?? ''),
    time: Number(pick(m, 'time', 2) ?? 0),
    edited: Number(pick(m, 'edited', 3) ?? 0),
    replyTo: Number(pick(m, 'replyTo', 4) ?? 0),
    quoteOf: Number(pick(m, 'quoteOf', 5) ?? 0),
    deleted: Boolean(pick(m, 'deleted', 6)),
    likes: Number(pick(m, 'likes', 7) ?? 0),
    replies: Number(pick(m, 'replies', 8) ?? 0),
    reposts: Number(pick(m, 'reposts', 9) ?? 0),
    body: String(bodyText ?? ''),
  };
  post.who = await whoOf(masks, post.mask);
  if (me) {
    post.liked = Boolean(likedFlag);
    post.reposted = Number(repostFlag ?? 0) > 0;
  }
  if (post.quoteOf && depth > 0) post.quoted = (await readPost(chirp, masks, me, post.quoteOf, depth - 1)) ?? undefined;
  return post;
}

/**
 * Every post, newest first, read once and reused.
 *
 * The profile, search, the Following tab and notifications are all slices of the
 * same list, so it is fetched once per refresh instead of once per view. At this
 * size that is cheaper than being clever, and it keeps every view consistent
 * with the others.
 */
/**
 * The last feed we read, kept on the device so opening chirp shows something at
 * once instead of three grey rectangles.
 *
 * It is a cache of public data, not a source of truth: it is painted, then
 * replaced by whatever the chain actually says, and it is never written to the
 * chain or used to decide anything. Old enough and it is ignored — a stale
 * timeline presented as current would be worse than a slow one.
 */
const CACHE = 'chirp.feed';
const CACHE_MS = 6 * 3600 * 1000;

export function cachedFeed(): Post[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE) ?? 'null');
    if (!raw || Date.now() - raw.at > CACHE_MS) return [];
    return raw.posts as Post[];
  } catch { return []; }
}

function cacheFeed(posts: Post[]) {
  try {
    // Only the newest slice: the whole timeline in localStorage is a quota
    // error waiting to happen, and nobody scrolls to the bottom on a cold open.
    localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), posts: posts.slice(0, 40) }));
  } catch { /* private mode, or full */ }
}

/** How many chirps the contract holds, as of the last read. The feed shows a
 *  window; without this the app cannot tell "that is all of them" from "there
 *  are more and you cannot reach them", and it was quietly showing the second
 *  as if it were the first. */
export let TOTAL = 0;

export async function loadAll(limit = 300, onBatch?: (soFar: Post[]) => void): Promise<Post[]> {
  const { chirp, masks, me } = await handles();
  if (!chirp) return [];
  const total = Number((await q(chirp, 'count')) ?? 0);
  TOTAL = total;
  const ids: number[] = [];
  for (let id = total; id > 0 && ids.length < limit; id--) ids.push(id);
  // Batched rather than one-at-a-time: sequential reads made the feed crawl as
  // soon as there were more than a handful of posts.
  //
  // The batch is 25, not 10. Each round trip costs roughly a second whatever is
  // in it, so the count of ROUNDS is what the wait actually is: twenty-five
  // chirps at ten a time is three rounds of reads plus their author lookups,
  // and at twenty-five it is one. The node is doing the same total work either
  // way — it is only being asked to do more of it at once.
  const B = 25;
  const out: Post[] = [];
  for (let i = 0; i < ids.length; i += B) {
    const batch = await Promise.all(ids.slice(i, i + B).map((id) => readPost(chirp, masks, me, id)));
    for (const p of batch) if (p && !p.deleted) out.push(p);
    // Hand back each batch as it lands. Waiting for the last of three hundred
    // before showing the first ten is most of what "slow" meant here.
    onBatch?.(out.slice());
  }
  cacheFeed(out);
  return out;
}

/**
 * Rank the timeline the way a For You feed is ranked, minus the part we cannot
 * honestly build.
 *
 * X's heavy ranker is a neural net over signals we do not have — dwell time,
 * an out-of-network engagement graph, a profile of what you linger on. What IS
 * transferable is the shape: candidates from two sources, in-network and out,
 * then one scorer over them. So this is engagement, affinity and decay, and it
 * is arithmetic rather than anything learned. It is stated plainly here because
 * a ranked feed that will not say why it ranked is the thing people object to.
 *
 *   engagement  likes, replies and reposts, with a reply worth more than a like
 *               because it cost more to give
 *   affinity    written by someone you follow, or quoting someone you do
 *   decay       halves every twelve hours, so a good chirp does not sit on top
 *               of the feed for a week
 *   penalty     a chirp carrying a note that bridged is pushed down, not hidden
 */
export type RankSignals = {
  /** followers per mask, so a voice many people chose to hear carries further */
  followers?: Map<number, number>;
  /** the words you have engaged with, weighted — your own topics, not a profile */
  interests?: Map<string, number>;
};

/** Why a chirp is where it is, so the feed can be asked and answer. */
export type Why = { total: number; parts: { label: string; value: number }[] };

export function rankWhy(
  p: Post, follow: Set<number>, noted: Map<number, Note>, sig: RankSignals = {}, now = Date.now() / 1000,
): Why {
  const HALF_LIFE = 12 * 3600;

  const engagement = p.likes + p.replies * 2.5 + p.reposts * 2;
  const affinity = (follow.has(p.mask) ? 6 : 0) + (p.quoted && follow.has(p.quoted.mask) ? 2 : 0);

  // Reach, from the follower count — but through a logarithm, so a hundred
  // followers is worth about twice ten rather than ten times. Straight
  // multiplication would hand the whole timeline to whoever is biggest, which
  // is the failure mode people already complain about.
  const reach = Math.log10(1 + (sig.followers?.get(p.mask) ?? 0)) * 3;

  // Subject matter: the words you have actually liked, replied to or written,
  // counted from the chain and kept on the device. Not a behavioural profile —
  // no dwell time, no scroll telemetry, nothing that is not a public act.
  let interest = 0;
  if (sig.interests?.size) {
    for (const w of words(p.body)) interest += sig.interests.get(w) ?? 0;
    interest = Math.min(interest, 8);   // capped, or one hot word owns the feed
  }

  // Two content signals X uses that cost nothing to compute honestly: a chirp
  // that started a conversation, and one that is all tags and no substance.
  const conversation = p.replies >= 3 ? 3 : 0;
  const spammy = (p.body.match(/#/g)?.length ?? 0) > 4 || p.body.length < 4 ? 0.4 : 1;

  const decay = Math.pow(0.5, Math.max(0, now - p.time) / HALF_LIFE);
  const noteDrag = noted.has(p.id) ? 0.35 : 1;

  // +1 so a chirp with no engagement still ranks by recency rather than tying
  // at zero with every other silent one.
  const base = engagement + affinity + reach + interest + conversation + 1;
  return {
    total: base * decay * spammy * noteDrag,
    parts: [
      { label: 'engagement', value: engagement },
      { label: 'you follow them', value: affinity },
      { label: 'reach', value: reach },
      { label: 'your topics', value: interest },
      { label: 'started a conversation', value: conversation },
      { label: 'recency', value: decay },
      { label: 'context added', value: noteDrag },
      { label: 'thin or tag-stuffed', value: spammy },
    ].filter((x) => x.value !== 0 && x.value !== 1),
  };
}

export function rank(
  posts: Post[], follow: Set<number>, noted: Map<number, Note>, sig: RankSignals = {}, now = Date.now() / 1000,
): Post[] {
  return [...posts].sort((a, b) => rankWhy(b, follow, noted, sig, now).total - rankWhy(a, follow, noted, sig, now).total);
}

/** Words worth indexing: no punctuation, no one-letter noise, no stop words. */
const STOP = new Set('the a an and or but of to in on for with is are was were be been it its this that these those i you he she we they at as by from not no so if then than there here what who which when how why all any can will just dont do does did have has had my your our their more most some such only own same too very'.split(' '));
export function words(s: string): string[] {
  return [...new Set(
    s.toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z0-9#][a-z0-9_'-]{2,}/g) ?? [],
  )].filter((w) => !STOP.has(w));
}

/**
 * What you have shown interest in, derived only from public acts: the chirps
 * you wrote, liked or replied to. It is computed here and never leaves the
 * device — the chain already knows all of it, but nobody needs a tidy summary
 * of your preferences sitting anywhere.
 */
export function interestsFrom(all: Post[], myMask: number, liked: Set<number>): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (s: string, w: number) => { for (const t of words(s)) out.set(t, (out.get(t) ?? 0) + w); };
  for (const p of all) {
    if (p.mask === myMask) bump(p.body, 1.5);          // what you write says most
    else if (liked.has(p.id)) bump(p.body, 1);
  }
  return out;
}

/** Follower counts for every mask, for the ranker and the stats page. */
export async function followerCounts(): Promise<Map<number, number>> {
  const { masks, chirp } = await handles();
  const out = new Map<number, number>();
  if (!masks || !chirp) return out;
  const total = Number((await q(masks, 'totalSupply')) ?? 0);
  for (let i = 1; i <= total; i += 20) {
    const ids = Array.from({ length: Math.min(20, total - i + 1) }, (_, k) => i + k);
    const got = await Promise.all(ids.map((n) => q(chirp, 'followerCount', BigInt(n))));
    ids.forEach((n, k) => out.set(n, Number(got[k] ?? 0)));
  }
  return out;
}

/**
 * Your numbers.
 *
 * Everything here is counted from chirps and follows that are already public,
 * so there is nothing to collect and nothing to leak. Note what is ABSENT:
 * impressions, views, reach, watch time. Those need a server watching people
 * read, and there is no server — a number for them would have to be invented,
 * and an invented number on an analytics page is a lie with a chart on it.
 */
export type Stats = {
  chirps: number; replies: number; likesGot: number; repliesGot: number; repostsGot: number;
  likesGave: number; followers: number; following: number;
  /** engagement per chirp, the only ratio that means anything without views */
  perChirp: number;
  /** your busiest hour of the day, 0-23, and how many chirps landed in it */
  bestHour: { hour: number; n: number } | null;
  /** last 14 days, oldest first: chirps you wrote and engagement you received */
  days: { day: string; posts: number; got: number }[];
  /** your most engaged chirps */
  top: Post[];
  /** the words you use, most first */
  topics: { word: string; n: number }[];
};

export function statsFor(mask: number, all: Post[], followers: number, following: number, likesGave: number): Stats {
  const mine = all.filter((p) => p.mask === mask && !p.deleted);
  const roots = mine.filter((p) => !p.replyTo);
  const likesGot = mine.reduce((n, p) => n + p.likes, 0);
  const repliesGot = mine.reduce((n, p) => n + p.replies, 0);
  const repostsGot = mine.reduce((n, p) => n + p.reposts, 0);

  const byHour = new Map<number, number>();
  for (const p of mine) {
    const h = new Date(p.time * 1000).getHours();
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  const best = [...byHour].sort((a, b) => b[1] - a[1])[0];

  const days: { day: string; posts: number; got: number }[] = [];
  const dayKey = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const today = Math.floor(Date.now() / 1000);
  for (let d = 13; d >= 0; d--) {
    const key = dayKey(today - d * 86400);
    const on = mine.filter((p) => dayKey(p.time) === key);
    days.push({ day: key, posts: on.length, got: on.reduce((n, p) => n + p.likes + p.replies + p.reposts, 0) });
  }

  const counts = new Map<string, number>();
  for (const p of mine) for (const w of words(p.body)) counts.set(w, (counts.get(w) ?? 0) + 1);

  return {
    chirps: roots.length,
    replies: mine.length - roots.length,
    likesGot, repliesGot, repostsGot, likesGave, followers, following,
    perChirp: mine.length ? (likesGot + repliesGot + repostsGot) / mine.length : 0,
    bestHour: best ? { hour: best[0], n: best[1] } : null,
    days,
    top: [...mine].sort((a, b) => (b.likes + b.replies + b.reposts) - (a.likes + a.replies + a.reposts)).slice(0, 5),
    topics: [...counts].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n).slice(0, 10),
  };
}

/** Everyone who holds a mask — the people you can search and follow. */
export async function people(): Promise<Who[]> {
  const { masks } = await handles();
  if (!masks) return [];
  const total = Number((await q(masks, 'totalSupply')) ?? 0);
  const ids = Array.from({ length: total }, (_, i) => i + 1);
  const out: Who[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    out.push(...(await Promise.all(ids.slice(i, i + 10).map((n) => whoOf(masks, n)))));
  }
  return out;
}

/** The masks you follow. The contract keys follows by (you, mask), so this asks
 *  about each mask rather than reading a list that does not exist on chain. */
export async function following(): Promise<Set<number>> {
  const s = await session().catch(() => null);
  if (!s) return new Set();
  const total = Number((await q(s.masks, 'totalSupply')) ?? 0);
  const flags = await Promise.all(
    Array.from({ length: total }, (_, i) => q(s.chirp, 'follows', s.h160, BigInt(i + 1))),
  );
  const set = new Set<number>();
  flags.forEach((on, i) => { if (on) set.add(i + 1); });
  return set;
}

/**
 * Who follows a mask, and who it follows.
 *
 * The contract keys follows by (account, mask), so there is no list to read —
 * but every account that can follow is the owner of a mask, and the mask supply
 * is enumerable. So the set of candidates IS knowable: walk the masks, ask who
 * owns each, and ask the contract about that pair. It is a scan, but a bounded
 * one, and it beats showing a number nobody can open.
 */
export async function connections(mask: number): Promise<{ followers: Who[]; followingList: Who[] }> {
  const { masks, chirp } = await handles();
  if (!masks || !chirp) return { followers: [], followingList: [] };
  const total = Number((await q(masks, 'totalSupply')) ?? 0);
  const ids = Array.from({ length: total }, (_, i) => i + 1);

  const owners = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 10) {
    const slice = ids.slice(i, i + 10);
    const got = await Promise.all(slice.map((n) => q(masks, 'ownerOf', BigInt(n))));
    slice.forEach((n, k) => { const o = got[k]; if (o) owners.set(n, String(o)); });
  }

  const [followsMe, iFollow] = await Promise.all([
    Promise.all(ids.map((n) => (owners.has(n) ? q(chirp, 'follows', owners.get(n), BigInt(mask)) : undefined))),
    Promise.all(ids.map((n) => (owners.has(mask) ? q(chirp, 'follows', owners.get(mask), BigInt(n)) : undefined))),
  ]);

  const pickWho = async (flags: unknown[]) => {
    const wanted = ids.filter((_, i) => Boolean(flags[i]));
    const out: Who[] = [];
    for (let i = 0; i < wanted.length; i += 10) {
      out.push(...(await Promise.all(wanted.slice(i, i + 10).map((n) => whoOf(masks, n)))));
    }
    return out;
  };
  return { followers: await pickWho(followsMe), followingList: await pickWho(iFollow) };
}

/** A profile: who they are, what they wrote, and how they connect. */
export async function profile(mask: number, feed?: Post[]): Promise<{
  who: Who; bio: string; telegram: string; x: string;
  followers: number; posts: Post[]; isMe: boolean; iFollow: boolean;
}> {
  const h = await handles();
  const { masks } = h;
  // `ready`, not session(): opening a profile must not wait on the wallet
  // handshake. Without it the two "is this me / do I follow them" lines are
  // simply absent for a few seconds, which beats an empty page.
  const s = ready;
  const who = masks ? await whoOf(masks, mask) : { mask, name: '', verified: '', handle: '', tier: 4 };
  const p = masks ? await q(masks, 'profileOf', BigInt(mask)) : undefined;
  // Same as notifications: opening a profile re-read the entire timeline.
  const all = feed ?? await loadAll();
  const followers = Number((await q(h.chirp, 'followerCount', BigInt(mask))) ?? 0);
  const myMask = s ? Number((await q(s.masks, 'maskOf', s.h160)) ?? 0) : 0;
  return {
    who,
    bio: String(pick(p, 'bio', 3) ?? ''),
    telegram: String(pick(p, 'telegram', 1) ?? ''),
    x: String(pick(p, 'x', 2) ?? ''),
    followers,
    posts: all.filter((z) => z.mask === mask),
    isMe: myMask === mask,
    iFollow: s ? Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask))) : false,
  };
}

/** What happened to you: replies and quotes of your posts, newest first. There
 *  is no notification store on chain, so this is derived from the feed. */
export async function notifications(myMask: number, feed?: Post[]): Promise<Post[]> {
  if (!myMask) return [];
  // Take the feed the caller already has. This used to re-read the whole thing —
  // with a poll every twenty seconds that was the timeline fetched twice a
  // minute for no new information.
  const all = feed ?? await loadAll();
  const mine = new Set(all.filter((p) => p.mask === myMask).map((p) => p.id));
  return all.filter((p) => p.mask !== myMask && ((p.replyTo && mine.has(p.replyTo)) || (p.quoteOf && mine.has(p.quoteOf))));
}

/** The timeline, newest first. Replies are left out of the main feed — they
 *  belong to their thread, exactly as they do on X. */
export async function feed(limit = 30): Promise<Post[]> {
  const { chirp, masks, me } = await handles();
  if (!chirp) return [];
  const total = Number((await q(chirp, 'count')) ?? 0);
  const out: Post[] = [];
  for (let id = total; id > 0 && out.length < limit; id--) {
    const p = await readPost(chirp, masks, me, id);
    if (!p || p.deleted || p.replyTo) continue;
    out.push(p);
  }
  return out;
}

/** A post with its parent chain and its direct replies — the thread view. */
export async function thread(id: number): Promise<{ parents: Post[]; post: Post | null; replies: Post[] }> {
  const { chirp, masks, me } = await handles();
  if (!chirp) return { parents: [], post: null, replies: [] };
  const post = await readPost(chirp, masks, me, id);
  const parents: Post[] = [];
  let up = post?.replyTo ?? 0;
  while (up && parents.length < 6) {
    const p = await readPost(chirp, masks, me, up);
    if (!p) break;
    parents.unshift(p);
    up = p.replyTo;
  }
  // The replies come out of the one feed read the app already does, instead of
  // walking every chirp again for each thread opened.
  const all = await loadAll();
  const replies = all.filter((p) => p.replyTo === id);
  return { parents, post, replies };
}

/** Who you are, and the profile you can edit. Null outside the Polkadot app. */
export async function me(): Promise<Me | null> {
  const s = await session().catch(() => null);
  if (!s) return null;
  const mask = Number((await q(s.masks, 'maskOf', s.h160)) ?? 0);
  if (!mask) return { address: s.address, kind: s.kind, mask: 0, name: '', verified: '', handle: '', tier: 4, telegram: '', x: '', bio: '' };
  const who = await whoOf(s.masks, mask);
  const p = await q(s.masks, 'profileOf', BigInt(mask));
  return {
    ...who,
    address: s.address,
    kind: s.kind,
    telegram: String(pick(p, 'telegram', 1) ?? ''),
    x: String(pick(p, 'x', 2) ?? ''),
    bio: String(pick(p, 'bio', 3) ?? ''),
  };
}

/** The username the host says you have on the People chain, to offer as a
 *  default display name. Host-attested, not provable on chain — so it is only
 *  ever a suggestion, never a tick. */
export async function suggestedName(): Promise<string> {
  try {
    const host = await import('@parity/product-sdk-host');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ap: any = await (host.getAccountsProvider() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getUserId()), ACCOUNT_MS, 'user id');
    return String(r?.value?.primaryUsername ?? '');
  } catch {
    return '';
  }
}

/* -------------------------------------------------------------------- notes */
//
// Community notes, scored the way X scores them, but computed here rather than
// announced by us.
//
// The naive ranking — most votes wins — hands the verdict to the largest
// faction. The bridging model instead fits every rater and every note on a
// latent axis and keeps what survives AFTER that axis is removed, which in
// practice means the note was rated helpful by people on opposite sides of it.
//
//   predicted(rater u, note n) = mu + i_u + i_n + f_u * f_n
//
// f_u and f_n are the viewpoint coordinates; i_n is the note's intercept, the
// part of its helpfulness that does NOT depend on which side you are on. That
// intercept is the score. It is fitted by plain gradient descent over the whole
// rating log, which is small here and public, so any reader's client can run
// this same function and get the same answer.
//
// The thresholds below are OURS, not X's. Theirs are tuned on millions of
// ratings; on a chain with a handful of masks they would leave everything
// unscored forever. They are named here so they can be argued with.

export type Note = {
  id: number;
  chirpId: number;
  mask: number;
  author: string;
  time: number;
  edited: number;
  kind: number;           // 0 context, 1 misleading
  ratings: number;
  body: string;
  who?: Who;
  /** The fitted intercept. Undefined until enough ratings exist to fit at all. */
  score?: number;
  /** True when the intercept clears the bar AND both sides of the axis rated it. */
  helpful?: boolean;
  /** What you rated it, or undefined. */
  mine?: number;
};

/** Below this there is nothing to fit: two ratings cannot describe an axis. */
const MIN_RATINGS = 4;
/** The intercept a note must reach. Deliberately low for a chain this small. */
const HELPFUL_AT = 0.25;

export type Rating = { noteId: number; mask: number; value: number };

/** Every rating, as one flat read. The contract keeps this log precisely so the
 *  matrix can be rebuilt in one pass instead of one round trip per note. */
export async function allRatings(): Promise<Rating[]> {
  const { notes } = await handles();
  if (!notes) return [];
  const total = Number((await q(notes, 'totalRatings')) ?? 0);
  const out: Rating[] = [];
  for (let i = 0; i < total; i += 20) {
    const got = await Promise.all(
      Array.from({ length: Math.min(20, total - i) }, (_, k) => q(notes, 'ratingAt', BigInt(i + k))),
    );
    for (const r of got) {
      if (!r) continue;
      out.push({
        noteId: Number(pick(r, 'noteId', 0) ?? 0),
        mask: Number(pick(r, 'mask', 1) ?? 0),
        value: Number(pick(r, 'value', 2) ?? 0),
      });
    }
  }
  return out;
}

/**
 * Fit the bridging model and return each note's intercept.
 *
 * Ratings arrive as 0/1/2 and are mapped to -1/0/+1, so "somewhat" is neutral
 * rather than mild approval — a rater who never picks a side should not drag a
 * note either way.
 */
export function bridge(ratings: Rating[]): Map<number, { score: number; sides: number }> {
  const noteIds = [...new Set(ratings.map((r) => r.noteId))];
  const maskIds = [...new Set(ratings.map((r) => r.mask))];
  const ni = new Map(noteIds.map((id, i) => [id, i]));
  const mi = new Map(maskIds.map((id, i) => [id, i]));

  const iN = new Float64Array(noteIds.length);
  const fN = new Float64Array(noteIds.length);
  const iU = new Float64Array(maskIds.length);
  const fU = new Float64Array(maskIds.length);
  // Seed the factors apart. All-zero factors have zero gradient and the model
  // would never leave the flat spot at the origin.
  for (let i = 0; i < fN.length; i++) fN[i] = ((i % 2) ? 0.1 : -0.1);
  for (let i = 0; i < fU.length; i++) fU[i] = ((i % 2) ? -0.1 : 0.1);
  let mu = 0;

  const obs = ratings.map((r) => ({ n: ni.get(r.noteId)!, u: mi.get(r.mask)!, y: r.value - 1 }));
  const LR = 0.02, L2 = 0.03, STEPS = 900;
  for (let s = 0; s < STEPS; s++) {
    for (const o of obs) {
      const err = (mu + iN[o.n] + iU[o.u] + fN[o.n] * fU[o.u]) - o.y;
      const gN = fU[o.u], gU = fN[o.n];
      mu -= LR * err;
      iN[o.n] -= LR * (err + L2 * iN[o.n]);
      iU[o.u] -= LR * (err + L2 * iU[o.u]);
      fN[o.n] -= LR * (err * gN + L2 * fN[o.n]);
      fU[o.u] -= LR * (err * gU + L2 * fU[o.u]);
    }
  }

  // A high intercept from a crowd that all sits on one side of the axis is not
  // a bridge, so count how many DISTINCT sides actually rated it helpfully.
  const out = new Map<number, { score: number; sides: number }>();
  for (const id of noteIds) {
    const n = ni.get(id)!;
    const helpfulRaters = ratings.filter((r) => r.noteId === id && r.value === 2);
    const sides = new Set(helpfulRaters.map((r) => (fU[mi.get(r.mask)!] >= 0 ? 'a' : 'b'))).size;
    out.set(id, { score: iN[n] + mu, sides });
  }
  return out;
}

/** The notes on a chirp, scored. */
export async function notesOn(chirpId: number, ratings?: Rating[]): Promise<Note[]> {
  const { notes, masks, handles: hc } = await handles();
  if (!notes) return [];
  const ids: number[] = ((await q(notes, 'notesOf', BigInt(chirpId))) as unknown[] ?? []).map((x) => Number(x));
  if (!ids.length) return [];
  const rows = ratings ?? await allRatings();
  const scores = bridge(rows);
  const mine = await myMask();

  const out: Note[] = [];
  for (const id of ids) {
    const [m, b] = await Promise.all([q(notes, 'meta', BigInt(id)), q(notes, 'body', BigInt(id))]);
    if (!m || Boolean(pick(m, 'retracted', 5))) continue;
    const mask = Number(pick(m, 'mask', 1) ?? 0);
    const sc = scores.get(id);
    const n: Note = {
      id,
      chirpId: Number(pick(m, 'chirpId', 0) ?? 0),
      mask,
      author: String(pick(m, 'author', 2) ?? ''),
      time: Number(pick(m, 'time', 3) ?? 0),
      edited: Number(pick(m, 'edited', 4) ?? 0),
      kind: Number(pick(m, 'kind', 6) ?? 0),
      ratings: Number(pick(m, 'ratings', 7) ?? 0),
      body: String(b ?? ''),
      who: masks ? await whoOf(masks, mask, hc) : undefined,
      mine: mine ? rows.find((r) => r.noteId === id && r.mask === mine)?.value : undefined,
    };
    if (sc && n.ratings >= MIN_RATINGS) {
      n.score = sc.score;
      n.helpful = sc.score >= HELPFUL_AT && sc.sides >= 2;
    }
    out.push(n);
  }
  // The one that reached people who disagree goes first.
  return out.sort((a, b) => Number(b.helpful ?? false) - Number(a.helpful ?? false) || (b.score ?? -9) - (a.score ?? -9));
}

/** Which chirps carry a note that made it, so the feed can mark them in one pass
 *  rather than asking per post. */
export async function notedChirps(): Promise<Map<number, Note>> {
  const { notes } = await handles();
  const out = new Map<number, Note>();
  if (!notes) return out;
  const total = Number((await q(notes, 'count')) ?? 0);
  if (!total) return out;
  const rows = await allRatings();
  const scores = bridge(rows);
  for (let i = 1; i <= total; i += 20) {
    const ids = Array.from({ length: Math.min(20, total - i + 1) }, (_, k) => i + k);
    const metas = await Promise.all(ids.map((id) => q(notes, 'meta', BigInt(id))));
    await Promise.all(metas.map(async (m, k) => {
      if (!m || Boolean(pick(m, 'retracted', 5))) return;
      const id = ids[k];
      const sc = scores.get(id);
      const count = Number(pick(m, 'ratings', 7) ?? 0);
      if (!sc || count < MIN_RATINGS || sc.score < HELPFUL_AT || sc.sides < 2) return;
      const chirpId = Number(pick(m, 'chirpId', 0) ?? 0);
      const prev = out.get(chirpId);
      if (prev && (prev.score ?? -9) >= sc.score) return;
      out.set(chirpId, {
        id, chirpId, mask: Number(pick(m, 'mask', 1) ?? 0), author: String(pick(m, 'author', 2) ?? ''),
        time: Number(pick(m, 'time', 3) ?? 0), edited: Number(pick(m, 'edited', 4) ?? 0),
        kind: Number(pick(m, 'kind', 6) ?? 0), ratings: count,
        body: String((await q(notes, 'body', BigInt(id))) ?? ''),
        score: sc.score, helpful: true,
      });
    }));
  }
  return out;
}

async function myMask(): Promise<number> {
  if (!ready) return 0;   // reads must not queue behind the handshake
  return Number((await q(ready.masks, 'maskOf', ready.h160)) ?? 0);
}

export function addNote(chirpId: number, mask: number, kind: number, body: string): Promise<Ok | Fail> {
  return send('notes', 'add', [BigInt(chirpId), BigInt(mask), kind, body.slice(0, 700)]);
}
export function rateNote(id: number, mask: number, value: number): Promise<Ok | Fail> {
  return send('notes', 'rate', [BigInt(id), BigInt(mask), value]);
}

/* ------------------------------------------------------------------- writes */

/**
 * Submit a contract call.
 *
 * Plain when the signer is acting for itself. When it is somebody's proxy the
 * call is BUILT but not signed (`.prepare()`), then wrapped in Proxy.proxy so
 * the contract sees the real account as msg.sender. The gas dry-run is given the
 * same origin, or it would price the call for the wrong account.
 */
/** The host said it cannot sign with the wallet account it just handed us. */
const isNotImplemented = (why: string) =>
  /Not implemented|createTransactionWithLegacyAccount/i.test(why);

async function send(
  which: 'masks' | 'chirp' | 'handles' | 'notes' | 'pfp' | 'face',
  method: string,
  args: unknown[],
  retried = false,
): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (s as any)[which];
  try {
    if (!s.real) {
      const o = { ...LIMITS, ...(s.manager ? { signerManager: s.manager } : { signer: s.signer }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await withTimeout(c[method].tx(...args, o), TX_MS, 'transaction');
      if (res && res.ok === false) {
        const why = reason(res);
        // The wallet account cannot sign on this host build. Remember it, drop
        // the session, and come back on the app-derived account — which is a
        // DIFFERENT identity, so the caller is told rather than silently moved.
        if (isNotImplemented(why) && !retried && !s.manager) {
          legacyBroken.set();
          slot = null;
          return send(which, method, args, true);
        }
        return { ok: false, why };
      }
      return { ok: true, value: undefined };
    }
    const prepared = await withTimeout(
      c[method].prepare(...args, { ...LIMITS, origin: s.real }), TX_MS, 'preparing',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner: any = (prepared as any)?.value ?? prepared;
    const call = inner?.decodedCall ?? inner?.call ?? inner;
    if (!call) return { ok: false, why: 'Could not build the call to send through your proxy.' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await withTimeout(
      s.api.tx.Proxy.proxy({ real: { type: 'Id', value: s.real }, force_proxy_type: undefined, call })
        .signAndSubmit(s.signer),
      TX_MS,
      'transaction',
    );
    if (res && res.ok === false) return { ok: false, why: reason(res) };
    return { ok: true, value: undefined };
  } catch (e) {
    const why = reason({ error: e });
    if (isNotImplemented(why) && !retried && !s.manager) {
      legacyBroken.set();
      slot = null;
      return send(which, method, args, true);
    }
    return { ok: false, why };
  }
}

export function claimMask(dotLabel = ''): Promise<Ok | Fail> {
  return send('masks', 'claim', [dotLabel.trim().replace(/\.dot$/i, '')]);
}

/** Your public details. The name is free text you choose — the tick belongs to a
 *  `.dot`, which the contract verifies, and to nothing else. */
export function saveProfile(name: string, telegram: string, x: string, bio: string): Promise<Ok | Fail> {
  return send('masks', 'setProfile', [
    name.slice(0, 40), telegram.replace(/^@/, '').slice(0, 32), x.replace(/^@/, '').slice(0, 32), bio.slice(0, 160),
  ]);
}

/** Attach the People chain username this mask goes by. First come first served
 *  across masks; the app offers only what the host says is yours, but the chain
 *  cannot check that, so it is never shown with a tick. */
export function setHandle(mask: number, handle: string): Promise<Ok | Fail> {
  return send('handles', 'setHandle', [BigInt(mask), handle.trim().replace(/^@/, '')]);
}

export function post(mask: number, body: string, replyTo = 0, quoteOf = 0): Promise<Ok | Fail> {
  return send('chirp', 'chirp', [BigInt(mask), body, BigInt(replyTo), BigInt(quoteOf)]);
}

export function edit(id: number, body: string): Promise<Ok | Fail> {
  return send('chirp', 'edit', [BigInt(id), body]);
}

export function remove(id: number): Promise<Ok | Fail> {
  return send('chirp', 'remove', [BigInt(id)]);
}

/** A heart is a toggle: ask the chain what you already did rather than guessing,
 *  because liking twice reverts. */
export async function toggleLike(id: number): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  const already = Boolean(await q(s.chirp, 'liked', BigInt(id), s.h160));
  return send('chirp', already ? 'unlike' : 'like', [BigInt(id)]);
}

/** Reposting again retracts the repost you made — the contract remembers which
 *  chirp was yours, so this undoes rather than piling copies up. */
export async function toggleRepost(id: number, mask: number): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  const mine = Number((await q(s.chirp, 'repostOf', BigInt(id), s.h160)) ?? 0);
  return mine
    ? send('chirp', 'remove', [BigInt(mine)])
    : send('chirp', 'chirp', [BigInt(mask), '', 0n, BigInt(id)]);
}

export async function toggleFollow(mask: number): Promise<Ok | Fail> {
  const s = await session().catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  const on = Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask)));
  return send('chirp', 'follow', [BigInt(mask), !on]);
}

export async function isFollowing(mask: number): Promise<boolean> {
  const s = await session().catch(() => null);
  if (!s) return false;
  return Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask)));
}
