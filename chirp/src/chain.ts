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
import { keep } from './keep';
import MASKS_ABI from './masks-abi.json';
import CHIRP_ABI from './chirp-abi.json';
import HANDLES_ABI from './handles-abi.json';
import NOTES_ABI from './notes-abi.json';
import PFP_ABI from './pfp-abi.json';
import FACE_ABI from './face-abi.json';
import PIN_ABI from './pin-abi.json';
import POLLS_ABI from './chirppolls-abi.json';
import RULES_ABI from './chirprules-abi.json';
import MEDIA_ABI from './chirpmedia-abi.json';

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
 * Polls, and the only one of these three the chain truly enforces: a vote is a
 * transaction the contract validates, so the count is recountable by anyone.
 */
export const POLLS = '0x5b39063dbef4aa3e2ea1ae75b863da7f569796c3';
/**
 * Reply policy and blocks — PUBLISHED on chain, APPLIED by clients.
 *
 * Chirp2 was deployed before these existed and has no hook to consult, so
 * nothing can stop a caller posting a reply straight to it. Saying otherwise
 * would be a lie, and the app says so where a person can read it. What this
 * does give is a rule nobody can quietly change and anyone can audit — which is
 * more than a centralised network offers, and less than the block you are used
 * to. Both halves matter.
 */
export const RULES = '0xca9027bbad7cf18b6efcea945d91a2ece934c7ab';
/** Pictures inside a chirp: the bytes, not a link, for the reason PeopleFace
 *  exists — a key on chain with the image in a cache is not on chain at all. */
export const MEDIA = '0x02141db68fc4f70f724e8a72110951821f341e57';
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
/** The one chirp a profile leads with. On chain, because a pinned post is what
 *  OTHER people see when they arrive — a local one would pin it for nobody. */
export const PIN = '0x5f9199ca3c224321593c71ae2b44db29a725aabf';
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

  // A page rather than the image: try each derived candidate until one renders.
  if (isGifPage(url)) {
    for (const c of gifCandidates(url)) {
      const via = await gifBlob(c);
      if (via) { gifCache.set(url, via); return via; }
    }
    gifCache.set(url, '');
    return '';
  }

  // The TAG first, and usually only the tag.
  //
  // This used to fetch the bytes and wrap them in a blob URL, on the theory
  // that the container blocked remote images while permitting fetch. The probe
  // says otherwise, from inside the Polkadot app: Remote is granted
  // ({"ok":true,"value":true}), and an <img> against i.giphy.com loads at
  // 480x270. There was no image policy to work around — so the fetch was a
  // wasted round trip that FAILED for media.tenor.com, which sends no CORS
  // headers, and only then fell through to the thing that worked.
  const direct = await new Promise<string>((res) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const done = (v: string) => res(v);
    img.onload = () => done(img.naturalWidth > 1 ? url : '');   // a 1px answer is an error page
    img.onerror = () => done('');
    setTimeout(() => done(''), 8000);
    img.src = url;
  });
  gifCache.set(url, direct);            // remember either answer; do not re-ask per render
  return direct;
}

/**
 * Is this a GIF link?
 *
 * Two shapes, and the second one is the shape people actually have. A keyboard
 * inserts a MEDIA url — media.tenor.com/…/x.gif — but a person copying from the
 * Tenor or Giphy app or website gets a PAGE url, tenor.com/view/something-12345.
 * Refusing those was refusing the common case, and the button looked broken to
 * anyone who had not been handed a link by a keyboard.
 */
export function gifUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    if (!GIF_HOSTS.includes(h)) return false;
    if (/\.(gif|webp|mp4)($|\?)/i.test(u) || /\/media\//.test(u) || h.startsWith('media.') || h.startsWith('i.')) return true;
    // A page on one of those hosts: tenor.com/view/… or giphy.com/gifs/…
    return /\/(view|gifs|clips|stickers)\//.test(new URL(u).pathname);
  } catch { return false; }
}

/**
 * Will this link actually show as a picture?
 *
 * Measured, not assumed:
 *   media.tenor.com/…, i.giphy.com/… — yes, they are the image
 *   giphy.com/gifs/…                 — yes, the id is the last token and
 *                                      i.giphy.com/<id>.gif serves it
 *   tenor.com/view/…                 — NO. Appending .gif, the short bXQZk
 *                                      form and the older c.tenor.com paths
 *                                      were all tried and none serve an image;
 *                                      the page itself cannot be read either,
 *                                      because Tenor sends no CORS headers.
 *                                      Resolving it needs their API key.
 *
 * Worth being exact about, because the useful thing to tell someone holding a
 * Tenor page link is "copy the image's own address instead", and that is only
 * useful while they are still standing in front of the box.
 */
export function gifKind(u: string): 'image' | 'giphy-page' | 'tenor-page' | 'no' {
  if (!gifUrl(u)) return 'no';
  if (!isGifPage(u)) return 'image';
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '').endsWith('giphy.com')
      ? 'giphy-page' : 'tenor-page';
  } catch { return 'no'; }
}

/** A page url rather than the image itself — it has to be resolved first. */
const isGifPage = (u: string) => {
  try {
    const url = new URL(u);
    return !/\.(gif|webp|mp4)($|\?)/i.test(u) && /\/(view|gifs|clips|stickers)\//.test(url.pathname);
  } catch { return false; }
};

/**
 * Turn a Tenor or Giphy PAGE into image urls to try.
 *
 * Reading the page's og:image tag is the obvious route and it does not work
 * from a browser: neither host sends CORS headers on the page, so the fetch is
 * refused before the tag can be read. What DOES work is that both encode the
 * identity of the GIF in the url itself:
 *
 *   tenor.com/view/some-name-12345   →  the same url with .gif appended, which
 *                                       Tenor serves as the image
 *   giphy.com/gifs/some-name-abc123  →  i.giphy.com/<id>.gif, where the id is
 *                                       the last dash-separated token
 *
 * Several candidates rather than one, because neither is documented as a
 * contract and a guess that fails should fall through to the next guess.
 */
function gifCandidates(u: string): string[] {
  const out: string[] = [];
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const last = url.pathname.replace(/\/$/, '').split('/').pop() ?? '';
    if (host.endsWith('tenor.com')) {
      out.push(u.replace(/\/$/, '') + '.gif');
    }
    if (host.endsWith('giphy.com')) {
      const id = last.split('-').pop() ?? '';
      if (id) {
        out.push(`https://i.giphy.com/${id}.gif`);
        out.push(`https://media.giphy.com/media/${id}/giphy.gif`);
      }
    }
  } catch { /* not a url we can read */ }
  return out;
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

/**
 * Limits for a call that writes KILOBYTES rather than a number.
 *
 * Storing a picture reverted with `Revive.OutOfGas`: the figures above are
 * sized for a like or a follow — a word of storage — and a five-kilobyte write
 * is a different order of work entirely. Both parts have to grow: `ref_time`
 * for the hashing and copying, `proof_size` because the bytes themselves are
 * in the proof.
 *
 * Unused weight is refunded, so being generous costs nothing — but only up to a
 * ceiling, and going over it is worse than being tight. Read off this chain
 * (System.BlockWeights): a normal extrinsic may use at most
 *
 *   ref_time   1_599_875_000_000
 *   proof_size         8_388_608
 *
 * Ask for more and the transaction is refused before it runs at all. The first
 * attempt at this fix asked for 8_000_000_000_000, which is five times a whole
 * block, and would have traded OutOfGas for something harder to read.
 */
const BIG_LIMITS = {
  gasLimit: { ref_time: 1_400_000_000_000n, proof_size: 5_000_000n },
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
  // Seen through the dot.li gateway: the host holds an account for you but it
  // has no allowance to submit anything, so writing is impossible from there.
  // Reading still works, and saying which is which is the useful part.
  if (/no allowance set for account/i.test(d)) {
    return 'This gateway can show you chirp but cannot post for you — the account it gave you has no transaction allowance. Open chirp in the Polkadot app to write.';
  }
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
  signer: any; manager?: any; runtime: any; masks: any; chirp: any; handles: any; notes: any; pfp: any; face: any; pin: any; polls: any; rules: any; media: any;
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
  set: () => keep(NOLEGACY, '1'),
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
  // Not mapped here — see the note in connect(). Mapping is a transaction, and
  // nothing is signed until somebody asks to write.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mk = (addr: string, abi: unknown) => (contracts as any).createContract(runtime, addr, abi, { defaultSigner: signer, defaultOrigin: address });
  const api = client.getTypedApi(descriptors.devnet_asset_hub);
  const real = await proxiedAccount(api, address);
  return {
    address, h160: await h160Of(real ?? address), kind: 'wallet', signer, api, real, runtime,
    masks: mk(MASKS, MASKS_ABI), chirp: mk(CHIRP, CHIRP_ABI), handles: mk(HANDLES, HANDLES_ABI),
    notes: mk(NOTES, NOTES_ABI), pfp: mk(PFP, PFP_ABI), face: mk(FACE, FACE_ABI), pin: mk(PIN, PIN_ABI),
    polls: mk(POLLS, POLLS_ABI), rules: mk(RULES, RULES_ABI), media: mk(MEDIA, MEDIA_ABI),
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
  // NOTE what is NOT asked for here: permission to sign.
  //
  // It used to be, on connect, so the first thing anyone opening chirp saw was a
  // sheet asking to submit transactions on their behalf — before they had read a
  // single chirp, and whether or not they ever meant to post. On the gateway
  // that is worse than rude: there is often no wallet behind it, so the request
  // fails and the app looks broken while doing something the reader never asked
  // for. Reading this chain is public and needs no permission at all.
  //
  // It is requested at the first WRITE instead, in `askToSign()` — at the moment
  // it is actually needed, which is the moment it can be explained.
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

  // NOT mapped here, and this is the one that mattered.
  //
  // `ensureContractAccountMapped` submits `Revive.map_account` — a TRANSACTION,
  // not a check. Called on connect, it put a "Sign Transaction" sheet in front
  // of anyone who merely opened the app: call data 0x6407, two bytes, on a page
  // that had not yet drawn a single chirp. Asking somebody to sign something
  // before showing them anything is the worst first impression an app can make,
  // and on the gateway — where the account often has no allowance — it fails
  // too, so the reward for signing was an error.
  //
  // The mapping is only needed to WRITE. It is done in mapOnce(), from send().

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
    address, h160: await h160Of(who), kind, signer, manager, api, real, runtime,
    masks: mk(MASKS, MASKS_ABI), chirp: mk(CHIRP, CHIRP_ABI), handles: mk(HANDLES, HANDLES_ABI),
    notes: mk(NOTES, NOTES_ABI), pfp: mk(PFP, PFP_ABI), face: mk(FACE, FACE_ABI), pin: mk(PIN, PIN_ABI),
    polls: mk(POLLS, POLLS_ABI), rules: mk(RULES, RULES_ABI), media: mk(MEDIA, MEDIA_ABI),
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

/**
 * Can a transaction actually be made here?
 *
 * The obvious test — is there a signer — gives the wrong answer in the one place
 * this matters. Through the gateway a session DOES arrive and it DOES carry a
 * signer: `SignerManager` hands back an app-derived account whether or not a
 * wallet exists behind it. That account has no funds, and the host provider it
 * came with cannot serve a read, never mind broadcast a write.
 *
 * So the honest test is the one the app already performs on every load: if the
 * session's own provider could not answer `count()` on a contract holding
 * eighty chirps, it is not going to carry a transaction either. Two facts, both
 * measured, neither assumed.
 *
 * `null` means not yet known — the first read has not come back. Callers must
 * not turn that into "no": promising a reader that they cannot post, before
 * finding out, is the same lie in the other direction.
 */
export async function canSign(): Promise<boolean> {
  if (readerDead) return false;
  const s = await session().catch(() => null);
  return Boolean(s?.signer) && !readerDead;
}

/** Who the app is acting as, for the UI to say so plainly. */
export async function actingAs(): Promise<{ signer: string; real: string | null } | null> {
  const s = await session().catch(() => null);
  return s ? { signer: s.address, real: s.real } : null;
}

/** No further handshake attempts until this moment, and how many have failed. */
let coolUntil = 0;
let failures = 0;

/**
 * The wallet handshake, at most once — and after a failure, not again for a while.
 *
 * Failures are still not memoised: one bad boot must not make a session
 * impossible for as long as the tab is open, which is why this used to clear
 * `slot` and let the next caller try again. What that missed is WHO the next
 * caller is. Reads go through `handles()`, `handles()` asks for a session inside
 * a container, and the feed refreshes every twenty seconds — so on a gateway,
 * where the handshake can never succeed, chirp re-ran the whole thing on a
 * twenty-second loop. `SignerManager.connect()` raises a permission request, so
 * that is one "Sign and submit on-chain transactions on your behalf" dialog
 * every twenty seconds, stacking up behind each other over a page whose entire
 * job is to be readable without any of it. Nine of them were on screen inside
 * two minutes.
 *
 * So: retry, but back off — 30s, 60s, 2m, 4m, up to 10m. A deliberate write
 * passes `force` and ignores the cooldown, because somebody pressing a button is
 * evidence worth more than the last failure.
 */
function session(force = false): Promise<Slot | null> {
  if (!slot) {
    if (!force && Date.now() < coolUntil) return Promise.resolve(null);
    slot = connect().catch(() => null);
    void slot.then((s) => {
      if (!s) {
        slot = null;
        failures += 1;
        coolUntil = Date.now() + Math.min(30_000 * 2 ** (failures - 1), 600_000);
        return;
      }
      failures = 0; coolUntil = 0;
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

export function warmUp(): void {
  void session();
  void pub();
  void askDeviceRights();
  // Ask "are we in the app?" now, so a later click handler can read the cached
  // answer WITHOUT an await. Awaiting it inside a tap spends the user-activation
  // budget a popup needs, which is the trap this whole file has been walking
  // into all day.
  void insideHost();
}

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

/**
 * The device permissions this app needs, asked once, at startup.
 *
 * chirp was not following the rule the rest of this workspace follows, and it
 * is written down in the README: device capabilities are a SECOND, separate
 * gate from network origins. `OpenUrl` is what lets an app hand a link to the
 * browser; `Clipboard` is what the copy buttons need. Neither is mentioned by
 * the API that requires them, and the web shell grants both implicitly — so the
 * omission is invisible on a desktop and shows up on a phone as a button that
 * does nothing. Which is exactly what was reported.
 *
 * At startup, deliberately, and never mid-gesture: a permission prompt raised
 * during a tap spends the user-activation budget that the popup needs, so
 * asking late breaks the very thing it was asked for.
 *
 * Bounded, because a host call can queue for ever on a wedged channel and
 * opening the app must not wait on one.
 */
export async function askDeviceRights(): Promise<void> {
  try {
    const host = await import('@parity/product-sdk-host');
    if (!(await host.isInsideContainer().catch(() => false))) return;
    await Promise.race([
      Promise.all((['OpenUrl', 'Clipboard'] as const).map((k) =>
        host.requestDevicePermission(k).catch(() => undefined))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* older host, or no bridge: never block the app on a permission */ }
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
/**
 * Open a link — popup FIRST, and before anything is awaited.
 *
 * Two mistakes were stacked here, and together they meant no external link ever
 * opened from inside the Polkadot app.
 *
 * ONE: the comment said popups are blocked in the container. They are not. The
 * gateway embeds the app with
 *   sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
 * — read off the live page, not guessed. `allow-popups` is right there. What is
 * absent is `allow-popups-to-escape-sandbox`, so the new window inherits the
 * sandbox, and `allow-top-navigation`, so this frame cannot replace the whole
 * page. Neither of those stops a link opening.
 *
 * TWO, and this is what actually broke it: `window.open` only survives the popup
 * blocker when it is called inside the user gesture that asked for it. This
 * function used to `await import(...)` the host module and then race
 * `navigateTo` for up to three seconds BEFORE reaching the open call — by which
 * time the gesture is long over and the browser refuses, every time, silently.
 * Worse, `navigateTo` resolving with anything that was not literally `{ok:false}`
 * counted as success, so the app reported that it had opened a link it had not.
 *
 * So the popup is attempted synchronously, on the first line, with no await
 * ahead of it. `navigateTo` becomes the fallback rather than the gate, and the
 * caller still shows the address when both fail.
 */
/** What each route did, so a link that will not open can say WHICH gate refused
 *  instead of leaving somebody — and me — guessing a third time. */
export type OpenTrail = { ok: boolean; trail: string };

export async function openUrl(url: string, onLateFailure?: (t: OpenTrail) => void): Promise<OpenTrail> {
  const trail: string[] = [];

  // 1. A popup — but NEVER inside the Polkadot app, where it lies.
  //
  // Measured, finally, and it took four rounds: in the app's webview
  // `window.open` returns a Window object, that object is NOT closed a moment
  // later, and nothing is displayed. So the handle carries no information at
  // all there, and every check built on it — null means blocked, `.closed`
  // means it failed — is checking a value that cannot answer. Only outside the
  // app does the handle mean what the web platform says it means.
  //
  // `insideKnown` is a plain cached boolean rather than the promise, because
  // this branch has to run inside the click's user activation: `await` the
  // container question and the popup is refused by the blocker even where it
  // would have worked. It is populated at startup by warmUp.
  //
  // `noopener` is deliberately ABSENT where the popup IS attempted: per spec
  // `window.open(…, 'noopener')` returns null even on success, which would make
  // a working popup indistinguishable from a blocked one. The opener is severed
  // on the handle instead — same protection, without blinding the caller.
  if (insideKnown === true) trail.push('popup:skipped-in-app');
  try {
    const w = insideKnown === true ? null : window.open(url, '_blank');
    if (w) {
      try { (w as { opener: unknown }).opener = null; } catch { /* already isolated */ }
      trail.push('popup:handle');
      // A HANDLE IS NOT A WINDOW, and this is what "nothing happens, no error"
      // was: a webview can hand back a Window object and show nothing at all,
      // or open and close it immediately. openUrl took the handle as success,
      // returned ok, and the caller therefore had nothing to report — total
      // silence, which is the single worst outcome and the one this whole path
      // exists to prevent. The other eight apps check `.closed` a moment later;
      // chirp did not, because I wrote its opener by hand instead of reading
      // theirs. Now it checks, and tells the caller when the window is gone.
      setTimeout(() => {
        let gone = false;
        try { gone = w.closed; } catch { gone = false; }   // cross-origin: treat as open
        if (gone) onLateFailure?.({ ok: false, trail: trail.concat('popup:closed-immediately').join('>') });
      }, 700);
      return { ok: true, trail: trail.join('>') };
    }
    else if (insideKnown !== true) trail.push('popup:null');   // skipped is already recorded
  } catch (e) {
    trail.push('popup:threw:' + ((e as Error)?.name ?? '?'));
  }

  // NOT a synthetic anchor click. It was here for one revision and taken out:
  // a webview that cannot open a second window may honour target="_blank" by
  // navigating IN PLACE, which would replace chirp with the linked site and
  // throw the reader out of the app. A link that does not open is a small
  // failure; losing the app is not. Without evidence that it helps, the risk is
  // not worth taking.

  // 2. The host. Raced, because navigateTo can hang rather than answer, and
  //    checked for a REAL ok — "not false" was letting a non-answer through as
  //    success, so the app reported opening links it had not opened.
  const host = await import('@parity/product-sdk-host').catch(() => null);
  if (!host) {
    trail.push('host:none');
  } else {
    // Watch for the page going away BEFORE asking, because a navigation that
    // works may tear this document down before any promise settles.
    let departed = false;
    const noteDeparture = () => { departed = true; };
    document.addEventListener('visibilitychange', noteDeparture, { once: true });
    window.addEventListener('pagehide', noteDeparture, { once: true });

    // https, always, when handing an address to the host.
    //
    // The first real trail from a phone read
    //   popup:skipped-in-app>host:ok>host:said-ok-but-nothing-opened
    // on `http://www.polkadot.com` — plain http, because that is what the chirp
    // contained. A host that only hands https to a browser would behave exactly
    // like that: accept the call, answer ok, open nothing. It may not be the
    // cause, but it is the one candidate on OUR side of the line, it costs a
    // string replace, and it must be ruled out before the rest is reported as a
    // platform bug. The trail records the swap so the next report is unambiguous.
    const secure = url.replace(/^http:\/\//i, 'https://');
    if (secure !== url) trail.push('url:http->https');
    const r = await withTimeout(Promise.resolve(host.navigateTo(secure)), 3000, 'navigate')
      .catch((e) => ({ __threw: (e as Error)?.message ?? '?' }));
    const asAny = r as { ok?: boolean; error?: unknown; __threw?: string } | null;
    if (asAny?.__threw) trail.push('host:threw:' + asAny.__threw);
    else if (asAny?.ok === true) {
      trail.push('host:ok');
      // `ok` is the host saying it accepted the request, not that a browser
      // appeared. Same lie the popup handle told, one layer up — so it is
      // corroborated the way host-nav corroborates a deep link: if this page
      // never went to the background, nothing came up over it.
      setTimeout(() => {
        document.removeEventListener('visibilitychange', noteDeparture);
        window.removeEventListener('pagehide', noteDeparture);
        if (!departed && document.visibilityState === 'visible') {
          onLateFailure?.({ ok: false, trail: trail.concat('host:said-ok-but-nothing-opened').join('>') });
        }
      }, 1400);
      return { ok: true, trail: trail.join('>') };
    }
    else trail.push('host:' + JSON.stringify(asAny ?? null).slice(0, 60));
    document.removeEventListener('visibilitychange', noteDeparture);
    window.removeEventListener('pagehide', noteDeparture);
  }

  // Nothing opened. Put it on the clipboard and let the caller show both the
  // address and this trail — silence is the one outcome that leaves somebody
  // stuck, and "it does nothing" is not a bug report anybody can act on.
  try { await navigator.clipboard.writeText(url); trail.push('copied'); }
  catch { trail.push('copy:refused'); }
  return { ok: false, trail: trail.join('>') };
}

/* --------------------------------------------------------------------- chat */
//
// The Polkadot app has a chat, and it lets an app take part in it. What that
// bridge actually offers is narrow, and worth stating before anything is built
// on top of it:
//
//   registerRoom({roomId, name, icon})  create or join a room
//   sendMessage(roomId, {tag:'Text'})   say something in it
//   subscribeAction(cb)                 hear what happens in rooms we are in
//   subscribeChatList(cb)               the rooms we are in
//
// There is NO way to address a person. A room is named by a string we choose,
// and the host decides who can see it. So this cannot be "message @watanabe" —
// X's DM has no equivalent here, and pretending otherwise would produce a
// button that silently goes nowhere.
//
// What it CAN be is the thing a room is good at: a conversation attached to a
// chirp, in the app's own chat surface, where people already are. That is what
// this builds.

export type ChatRoomInfo = { roomId: string; participatingAs: string };

async function chatManager() {
  const host = await import('@parity/product-sdk-host').catch(() => null);
  return host ? await host.getChatManager().catch(() => null) : null;
}

/** Is the chat bridge here at all? False in a browser, and on hosts without it. */
export async function chatAvailable(): Promise<boolean> {
  return Boolean(await chatManager());
}

/** The room id for a chirp. Deterministic, so two people who open the same
 *  chirp land in the SAME room rather than each creating their own. */
export const roomOf = (chirpId: number) => `chirp-${chirpId}`;

/**
 * Open the conversation for a chirp, and put the chirp in it.
 *
 * `registerRoom` answers "New" or "Exists" — both are success, and the
 * difference is only worth telling the person because "Exists" means there may
 * already be something to read.
 */
export async function discuss(chirpId: number, title: string, opener: string): Promise<Ok<'New' | 'Exists'> | Fail> {
  const chat = await chatManager();
  if (!chat) return { ok: false, why: 'This app has no chat surface — open chirp in the Polkadot app.' };
  try {
    const status = await chat.registerRoom({
      roomId: roomOf(chirpId),
      name: title.slice(0, 60),
      icon: '',
    });
    // Only introduce the room when it is new. Re-posting the opener into a room
    // people are already talking in is the app shouting over them.
    if (status === 'New') await chat.sendMessage(roomOf(chirpId), { tag: 'Text', value: { text: opener } });
    return { ok: true, value: status as 'New' | 'Exists' };
  } catch (e) {
    return { ok: false, why: reason({ error: e }) };
  }
}

/** Say something into a chirp's room. */
export async function sayInChat(chirpId: number, text: string): Promise<Ok | Fail> {
  const chat = await chatManager();
  if (!chat) return { ok: false, why: 'No chat here.' };
  try {
    await chat.sendMessage(roomOf(chirpId), { tag: 'Text', value: { text: text.slice(0, 1000) } });
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, why: reason({ error: e }) };
  }
}

/** The chirp rooms this person is in, so the app can show which chirps have a
 *  conversation going rather than offering to start one that already exists. */
export async function chatRooms(): Promise<Set<number>> {
  const chat = await chatManager();
  const out = new Set<number>();
  if (!chat) return out;
  return new Promise((resolve) => {
    let sub: { unsubscribe(): void } | undefined;
    const done = () => { try { sub?.unsubscribe(); } catch { /* gone */ } resolve(out); };
    const timer = setTimeout(done, 4000);
    try {
      sub = chat.subscribeChatList((rooms) => {
        for (const r of rooms) {
          const m = /^chirp-(\d+)$/.exec(r.roomId);
          if (m) out.add(Number(m[1]));
        }
        clearTimeout(timer);
        done();
      });
    } catch { clearTimeout(timer); done(); }
  });
}

/* ---------------------------------------------------------------- the bot */
//
// The chat bridge is not a chat bridge. Read the whole protocol and it is a bot
// platform: `registerBot` puts an app in the chat as a participant, commands
// arrive as {command, payload}, messages can carry ACTION BUTTONS whose presses
// come back as {messageId, actionId}, and `customMessageRenderSubscribe` lets an
// app draw its OWN message type inside the host's chat.
//
// Which means chirp does not have to be a place you go. You can post from the
// chat you are already in, and read a chirp rendered as a card there.
//
// One honest limit, and it shapes everything below: an incoming action tells us
// the ROOM and the PEER, not a wallet we can sign for. So the bot can read
// commands and answer them, but a command that writes to the chain still needs
// the app to be open — the signature has to come from somewhere. Reads and
// answers work unattended; writes are queued and confirmed in the app.

export type BotAsk =
  | { kind: 'post'; text: string; room: string }
  | { kind: 'read'; count: number; room: string }
  | { kind: 'unknown'; command: string; room: string };

const BOT_ID = 'chirp';

/** Put chirp in the chat as a participant. Idempotent — "Exists" is success. */
export async function registerBot(): Promise<boolean> {
  const chat = await chatManager();
  if (!chat) return false;
  return await chat.registerBot({ botId: BOT_ID, name: 'chirp', icon: '' })
    .then(() => true).catch(() => false);
}

/**
 * Listen for what people ask the bot, and answer what can be answered without a
 * signature.
 *
 * `/chirp <text>` is handed to the caller to confirm in the app, because posting
 * needs a key. `/feed` is answered here and now, because reading needs nothing.
 */
export async function serveBot(
  onWrite: (ask: Extract<BotAsk, { kind: 'post' }>) => void,
): Promise<() => void> {
  const chat = await chatManager();
  if (!chat) return () => undefined;

  const sub = chat.subscribeAction(async (action) => {
    const room = (action as { roomId?: string })?.roomId ?? '';
    const payload = (action as { payload?: { tag?: string; value?: unknown } })?.payload;
    if (!payload || payload.tag !== 'Command') return;
    const cmd = payload.value as { command?: string; payload?: string };
    const name = String(cmd?.command ?? '').replace(/^\//, '').toLowerCase();
    const arg = String(cmd?.payload ?? '').trim();

    if (name === 'feed') {
      const posts = (await loadAll(5).catch(() => [])).filter((p) => !p.replyTo).slice(0, 5);
      const text = posts.length
        ? posts.map((p) => `${p.who ? (p.who.name || '@' + (p.who.handle || 'mask' + p.mask)) : 'mask ' + p.mask}: ${p.body.slice(0, 120)}`).join('\n\n')
        : 'Nothing on chirp yet.';
      await chat.sendMessage(room, { tag: 'Text', value: { text } }).catch(() => undefined);
      return;
    }
    if (name === 'chirp' && arg) {
      // Cannot be done here: a post is a transaction and this callback has no
      // key. Hand it to the app, which has one, and say so rather than
      // swallowing it.
      onWrite({ kind: 'post', text: arg, room });
      await chat.sendMessage(room, {
        tag: 'Text',
        value: { text: `Ready to post: "${arg.slice(0, 120)}"\nOpen chirp to sign it — a post is a transaction and the chat cannot sign.` },
      }).catch(() => undefined);
      return;
    }
    await chat.sendMessage(room, {
      tag: 'Text',
      value: { text: 'chirp understands /feed and /chirp <what you want to say>.' },
    }).catch(() => undefined);
  });

  return () => { try { sub.unsubscribe(); } catch { /* already gone */ } };
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
/**
 * Somebody's face, or nothing — and those are two different nothings.
 *
 * `''` means the chain answered and there is no picture. `null` means it was not
 * asked, it refused. The caller must tell them apart: the app latches each mask
 * so a face is fetched once, and latching a refusal as "no picture" is precisely
 * why every avatar on the gateway stayed generated. The first attempt ran
 * against the session's dead reader, and once the public reader took over
 * nothing ever asked again.
 */
export async function pictureOf(mask: number): Promise<string | null> {
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
  // Same rule as whoOf: only remember "this mask has no picture" when the chain
  // actually SAID so. `undefined` from both reads means they were refused, and
  // marking that as "no picture" leaves a generated face forever.
  if (bytesHex === undefined && raw === undefined) return null;
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
let reader: Promise<{ chirp: any; masks: any; handles: any; notes: any; pfp: any; face: any; pin: any; polls: any; rules: any; media: any } | null> | null = null;
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
        notes: mk(NOTES, NOTES_ABI), pfp: mk(PFP, PFP_ABI), face: mk(FACE, FACE_ABI), pin: mk(PIN, PIN_ABI),
    polls: mk(POLLS, POLLS_ABI), rules: mk(RULES, RULES_ABI), media: mk(MEDIA, MEDIA_ABI),
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
 * Set when the session's reader has been caught failing a read.
 *
 * The fallback used to live inside loadAll, which fixed the timeline and
 * nothing else: names, @handles, pictures, notes and follower counts all kept
 * asking the same dead reader, and `q` swallowed every refusal into
 * `undefined`. So the gateway showed a feed of "mask #16 @mask16" with
 * generated faces, over a chain that had names and pictures for all of them.
 *
 * One reader is either usable or it is not. Once it is not, everything moves.
 */
let readerDead = false;

/**
 * Are we inside the Polkadot app? Answered once and remembered, because the
 * answer decides which of the two readers is even possible.
 */
let inside: Promise<boolean> | null = null;
/** The same answer, cached as a plain value once it is known, so a click handler
 *  can branch on it WITHOUT an await — see openUrl for why that matters. */
let insideKnown: boolean | null = null;
function insideHost(): Promise<boolean> {
  if (!inside) {
    inside = import('@parity/product-sdk-host')
      .then((h) => h.isInsideContainer().catch(() => false))
      .catch(() => false);
    void inside.then((v) => { insideKnown = v; });
  }
  return inside;
}

async function handles() {
  if (ready && !readerDead) return { chirp: ready.chirp, masks: ready.masks, handles: ready.handles, notes: ready.notes, pfp: ready.pfp, face: ready.face, pin: ready.pin, polls: ready.polls, rules: ready.rules, media: ready.media, me: ready.h160 };
  if (readerDead) {
    // The session can still SIGN — send() uses it directly. It just cannot read.
    const p = await pub();
    if (p?.chirp) return { ...p, me: '' };
  }

  // Inside a container, PREFER the session: its reads carry the account, so
  // `liked` and `reposted` come back filled in, and the host's own provider is
  // the one the app is meant to use.
  //
  // But never let a failed session stop reading. It used to: this returned all
  // nulls and the timeline stayed empty forever. That is fine in the Polkadot
  // app, where a session always arrives — and fatal through the dot.li gateway,
  // which IS a container by every test but has no wallet behind it unless the
  // reader installs one. So anyone opening chirp on the web got the shell, the
  // tabs, the footer, and a feed that loaded for ever.
  //
  // Reading this chain is public. There is no reason to refuse to do it because
  // signing is unavailable.
  if (await insideHost()) {
    const s = await session().catch(() => null);
    if (s) return { chirp: s.chirp, masks: s.masks, handles: s.handles, notes: s.notes, pfp: s.pfp, face: s.face, pin: s.pin, polls: s.polls, rules: s.rules, media: s.media, me: s.h160 };
  } else {
    void session();   // outside: keep it warming, but do not wait on it
  }

  const p = await pub();
  return { ...(p ?? { chirp: null, masks: null, handles: null, notes: null, pfp: null, face: null, pin: null, polls: null, rules: null, media: null }), me: '' };
}

/** Handles for reads that are meaningless without an account — following, and
 *  anything keyed by who you are. These do wait. */
async function myHandles() {
  const s = await session().catch(() => null);
  return s ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * A read, or `undefined`.
 *
 * `success` is CHECKED. A contract query does not throw when it fails — it
 * resolves with `{success: false, value: unknown}`, and reading `.value`
 * regardless made a failure look like an answer. Through the gateway that
 * turned into `Number(...) ?? 0` and then into "No chirps yet" over a contract
 * holding eighty-five of them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = async (c: any, m: string, ...a: unknown[]) => {
  try {
    const r = await c?.[m]?.query(...a);
    return r?.success === false ? undefined : r?.value;
  } catch { return undefined; }
};

/**
 * The same read, but a failure is a failure.
 *
 * `q` swallows everything and hands back `undefined`, which the callers turn
 * into zero — so a chain that could not be reached is indistinguishable from a
 * chain that says there is nothing. That is how the gateway showed "No chirps
 * yet" over a contract holding eighty of them: the reads were failing and the
 * app reported an empty world.
 *
 * Used for the ONE read everything else hangs on, the count.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qStrict = async (c: any, m: string, ...a: unknown[]) => {
  if (!c?.[m]?.query) throw new Error('no contract to ask');
  const r = await c[m].query(...a);
  // The failure path RESOLVES rather than throwing, so it has to be looked for.
  if (r?.success === false) throw new Error(`the reader refused: ${JSON.stringify(r.value).slice(0, 90)}`);
  return r?.value;
};
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
    // Cache an ANSWER, never a failure. `q` returns undefined for both "the
    // chain says empty" and "the read was refused", and storing the second as
    // an identity is permanent: one bad moment and that person is "mask #16"
    // with no handle for the rest of the session, however well the chain
    // answers afterwards. If every field came back undefined, nothing was
    // learned — leave the cache alone and ask again next time.
    if (pr !== undefined || v !== undefined || t !== undefined || h !== undefined) {
      whoCache.set(mask, who);
    }
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
  // A dead reader is a diagnosis, not a life sentence. One dropped connection in
  // the Polkadot app would otherwise latch it for the whole session, and the
  // cost of that is real: the session's reads are the ones that carry the
  // account, so `liked` and `reposted` go blank, and canSign() starts telling a
  // wallet-holder they cannot post. Ask the session again — it is one query, on
  // a path that already has to run — and take it back if it answers.
  if (readerDead) {
    const s = await session().catch(() => null);
    // TWO reads, and one of them is an identity read — not `count` alone.
    // `count` is the cheapest question on the contract and a provider can
    // answer it while failing everything that carries an argument, which is
    // most of what the app asks for. Recovering on that one answer put the
    // session's reader back in charge of names and faces it could not serve.
    if (s && (await q(s.chirp, 'count')) !== undefined && (await q(s.masks, 'tierOf', 1n)) !== undefined) {
      readerDead = false;
      // Deliberately NOT clearing the caches here. They were cleared when the
      // reader DIED, because what they held then were refusals recorded as
      // answers. What they hold now are real names and real pictures, read from
      // a public RPC — identical bytes to whatever the session would return,
      // because this is public data. Throwing them away on recovery emptied
      // every name back to @maskN for no reason at all.
    }
  }
  const h = await handles();
  // THROW rather than return nothing. An empty list is rendered as "no chirps
  // yet", which is a claim — and when there is no reader at all the truth is
  // "could not ask", which deserves an error and a retry button instead.
  if (!h.chirp) throw new Error('No way to reach the chain from here.');

  // Read the count strictly, and if the reader we were handed cannot answer,
  // fall back to the public RPC and use THAT for the rest.
  //
  // Through the gateway a session exists — there is an account, the app says
  // "no mask yet" rather than "reading only" — but its provider could not serve
  // these reads, and `q` turned that into `undefined`, which became zero, which
  // the timeline printed as "No chirps yet" over a contract holding eighty.
  // Reading is public and needs no session at all, so a session that cannot
  // read must not be the end of it.
  let { chirp, masks, me } = h;
  let total: number;
  try {
    total = Number((await qStrict(chirp, 'count')) ?? 0);
  } catch {
    // Mark the reader dead FIRST, so that every other read in the app — names,
    // handles, pictures, notes, follower counts — moves with this one. Fixing
    // only the timeline left a feed of "mask #16" and generated faces over a
    // chain that had names and pictures for all of them.
    readerDead = true;
    forgetWho();                              // the blanks it cached are not answers
    forgetPicture();
    const p = await pub();
    if (!p?.chirp) throw new Error('The chain did not answer.');
    ({ chirp, masks } = p);
    me = '';                                  // the public reader knows nobody
    total = Number((await qStrict(chirp, 'count')) ?? 0);
  }
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
  // Six hours, not twelve. At twelve, a chirp from yesterday afternoon had lost
  // only half its weight while a chirp posted a minute ago had nothing to weigh
  // at all — so the top of the feed was reliably eleven hours old. Measured
  // before changing it: id 39, 11.4h old with six likes, scored 13.5; the
  // newest chirp scored 1.
  const HALF_LIFE = 6 * 3600;
  /** A new chirp has no engagement yet, and waiting for some is how it never
   *  gets any. So being new is itself worth something — a lot at first, gone
   *  within a few hours. This is the term that was missing: without it the
   *  ranking could only ever reward what had already been seen. */
  const NEW_BONUS = 9;
  const NEW_HALF_LIFE = 2 * 3600;

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

  const age = Math.max(0, now - p.time);
  const decay = Math.pow(0.5, age / HALF_LIFE);
  const fresh = NEW_BONUS * Math.pow(0.5, age / NEW_HALF_LIFE);
  const noteDrag = noted.has(p.id) ? 0.35 : 1;

  // +1 so a chirp with no engagement still ranks by recency rather than tying
  // at zero with every other silent one.
  const base = engagement + affinity + reach + interest + conversation + fresh + 1;
  return {
    total: base * decay * spammy * noteDrag,
    parts: [
      { label: 'just posted', value: fresh },
      { label: 'engagement', value: engagement },
      { label: 'you follow them', value: affinity },
      { label: 'reach', value: reach },
      { label: 'your topics', value: interest },
      { label: 'started a conversation', value: conversation },
      { label: 'recency', value: decay },
      { label: 'context added', value: noteDrag },
      { label: 'thin or tag-stuffed', value: spammy },
    ].filter((x) => Math.abs(x.value) > 0.01 && x.value !== 1),
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

/** What a notification is about, so the screen can say which. */
export type NoteKind = 'reply' | 'quote' | 'mention';
export type Notice = Post & { why: NoteKind };

/**
 * What happened to you: replies, quotes, and being MENTIONED.
 *
 * The mention was missing, which is the one X leads with — the app grew an @
 * autocomplete and then never told anybody they had been named. Nothing on
 * chain records a mention, so it is read out of the text the same way the
 * timeline renders it: the handle, the verified `.dot`, or `@maskN`. All three,
 * because all three are shown as an address somewhere in this app and a person
 * will use whichever they see.
 *
 * Derived from the feed rather than stored: there is no notification list on
 * chain, and inventing one would cost a transaction per notification.
 */
export async function notifications(myMask: number, feed?: Post[], me?: Who): Promise<Notice[]> {
  if (!myMask) return [];
  // Take the feed the caller already has. This used to re-read the whole thing —
  // with a poll every twenty seconds that was the timeline fetched twice a
  // minute for no new information.
  const all = feed ?? await loadAll();
  const mine = new Set(all.filter((p) => p.mask === myMask).map((p) => p.id));

  const names = ['@mask' + myMask];
  if (me?.handle) names.push('@' + me.handle);
  if (me?.verified) names.push('@' + me.verified + '.dot');
  const named = (body: string) => {
    const low = body.toLowerCase();
    // Bounded on both sides, so @watanabe does not fire on @watanabe2.
    return names.some((n) => new RegExp(`(^|[^a-z0-9_.])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_.])`).test(low));
  };

  const out: Notice[] = [];
  for (const p of all) {
    if (p.mask === myMask || p.deleted) continue;
    if (p.replyTo && mine.has(p.replyTo)) { out.push({ ...p, why: 'reply' }); continue; }
    if (p.quoteOf && mine.has(p.quoteOf)) { out.push({ ...p, why: 'quote' }); continue; }
    if (named(p.body)) out.push({ ...p, why: 'mention' });
  }
  return out;
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
/** Which weights a call needs. Only the picture write moves kilobytes; giving
 *  everything the large limits would make every dry-run needlessly heavy. */
const limitsFor = (which: string, method: string) =>
  ((which === 'face' && method === 'setFace') || (which === 'media' && method === 'attach')
    ? BIG_LIMITS
    : LIMITS);

/**
 * Ask for the permission to sign, once, at the first write.
 *
 * Without it the host never raises a signing sheet and the write hangs with no
 * error — the trap that cost a day early on. Asked here rather than on connect
 * so that reading, which needs nothing, is never gated behind a request to act
 * on somebody's behalf.
 *
 * `PreimageSubmit` rides along: it is only needed for a picture, and a person
 * setting one has already decided to write.
 */
/**
 * Map the account in pallet-revive, once, before the first write.
 *
 * A contract call from an unmapped account is rejected, so this has to happen —
 * but it is itself a transaction, and doing it on connect meant a signature
 * sheet for people who only came to read. Here it is one extra signature the
 * first time somebody writes, in a moment where signing is already expected.
 */
let mapped = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapOnce(s: any): Promise<void> {
  if (mapped) return;
  mapped = true;
  const contracts = await import('@parity/product-sdk/contracts').catch(() => null);
  if (!contracts) return;
  await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contracts as any).ensureContractAccountMapped(s.runtime, s.address, s.signer), 60_000, 'mapping',
  ).catch(() => undefined);
}

let signAsked = false;
async function askToSign(): Promise<void> {
  if (signAsked) return;
  signAsked = true;
  const host = await import('@parity/product-sdk-host').catch(() => null);
  if (!host) return;
  await withTimeout(Promise.resolve(host.requestPermission({ tag: 'ChainSubmit', value: undefined })), CONNECT_MS, 'permission')
    .catch(() => undefined);
  await withTimeout(Promise.resolve(host.requestPermission({ tag: 'PreimageSubmit', value: undefined })), CONNECT_MS, 'preimage permission')
    .catch(() => undefined);
}

/** The host said it cannot sign with the wallet account it just handed us. */
const isNotImplemented = (why: string) =>
  /Not implemented|createTransactionWithLegacyAccount/i.test(why);

async function send(
  which: 'masks' | 'chirp' | 'handles' | 'notes' | 'pfp' | 'face' | 'pin' | 'polls' | 'rules' | 'media',
  method: string,
  args: unknown[],
  retried = false,
): Promise<Ok | Fail> {
  // `true`: somebody pressed a button. That is a better reason to attempt the
  // handshake than the last failure is to skip it, so a write is never held back
  // by the cooldown — only the background reads are.
  const s = await session(true).catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  // The first write is where the permission is asked for, and where the account
  // gets mapped — not on open, when somebody may only want to read.
  await askToSign();
  await mapOnce(s);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (s as any)[which];
  try {
    if (!s.real) {
      const o = { ...limitsFor(which, method), ...(s.manager ? { signerManager: s.manager } : { signer: s.signer }) };
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
      c[method].prepare(...args, { ...limitsFor(which, method), origin: s.real }), TX_MS, 'preparing',
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

/**
 * Find the id a chirp we just posted was given.
 *
 * The contract assigns `++count`, so the newest id is the count — but between
 * our transaction and this read somebody else may have posted, and taking the
 * count on faith would chain the rest of a thread onto a stranger's chirp. So
 * walk back a few and take the newest one that is OURS and says what we said.
 * Cheap, and wrong is much worse than slow here.
 */
export async function findMine(mask: number, body: string): Promise<number> {
  const { chirp } = await handles();
  if (!chirp) return 0;
  const total = Number((await q(chirp, 'count')) ?? 0);
  for (let id = total; id > 0 && id > total - 8; id--) {
    const [m, b] = await Promise.all([q(chirp, 'meta', BigInt(id)), q(chirp, 'body', BigInt(id))]);
    if (!m) continue;
    if (Number(pick(m, 'mask', 0) ?? 0) === mask && String(b ?? '') === body) return id;
  }
  return 0;
}

/**
 * Post a thread: several chirps, each a reply to the one before.
 *
 * X calls this a thread and it is how anything longer than one post gets said.
 * There is nothing to add to the contract — a thread IS a chain of replies, and
 * `replyTo` already exists. What it needs is doing them in ORDER and finding
 * each id before writing the next, which is why this cannot be one transaction.
 *
 * Each part is signed separately, so a person can refuse halfway. If they do,
 * what is already posted stays posted: this reports how far it got rather than
 * pretending the whole thing failed, because those chirps are really on chain
 * and telling someone otherwise would send them looking for posts they can see.
 */
export async function postThread(
  mask: number,
  parts: string[],
  onStep?: (done: number, total: number) => void,
): Promise<Ok<number> | Fail> {
  let parent = 0;
  for (let i = 0; i < parts.length; i++) {
    onStep?.(i, parts.length);
    const r = await post(mask, parts[i], parent, 0);
    if (!r.ok) {
      return i === 0
        ? r
        : { ok: false, why: `${i} of ${parts.length} posted, then: ${r.why} The ones already sent are on chain.` };
    }
    if (i < parts.length - 1) {
      parent = await findMine(mask, parts[i]);
      if (!parent) {
        return { ok: false, why: `${i + 1} posted, but the chain could not confirm the id to reply to. The rest was not sent.` };
      }
    }
  }
  onStep?.(parts.length, parts.length);
  return { ok: true, value: parts.length };
}

/** The chirp a mask leads with, or 0. */
export async function pinnedOf(mask: number): Promise<number> {
  const { pin } = await handles();
  if (!pin || !mask) return 0;
  return Number((await q(pin, 'pinOf', BigInt(mask))) ?? 0);
}

export function pinChirp(mask: number, chirpId: number): Promise<Ok | Fail> {
  return send('pin', 'pin', [BigInt(mask), BigInt(chirpId)]);
}
export function unpinChirp(mask: number): Promise<Ok | Fail> {
  return send('pin', 'unpin', [BigInt(mask)]);
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
  // `true`: somebody pressed a button. That is a better reason to attempt the
  // handshake than the last failure is to skip it, so a write is never held back
  // by the cooldown — only the background reads are.
  const s = await session(true).catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  const already = Boolean(await q(s.chirp, 'liked', BigInt(id), s.h160));
  return send('chirp', already ? 'unlike' : 'like', [BigInt(id)]);
}

/** Reposting again retracts the repost you made — the contract remembers which
 *  chirp was yours, so this undoes rather than piling copies up. */
export async function toggleRepost(id: number, mask: number): Promise<Ok | Fail> {
  // `true`: somebody pressed a button. That is a better reason to attempt the
  // handshake than the last failure is to skip it, so a write is never held back
  // by the cooldown — only the background reads are.
  const s = await session(true).catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  const mine = Number((await q(s.chirp, 'repostOf', BigInt(id), s.h160)) ?? 0);
  return mine
    ? send('chirp', 'remove', [BigInt(mine)])
    : send('chirp', 'chirp', [BigInt(mask), '', 0n, BigInt(id)]);
}

export async function toggleFollow(mask: number): Promise<Ok | Fail> {
  // `true`: somebody pressed a button. That is a better reason to attempt the
  // handshake than the last failure is to skip it, so a write is never held back
  // by the cooldown — only the background reads are.
  const s = await session(true).catch(() => null);
  if (!s) return { ok: false, why: 'Nothing here can sign. Open chirp in the Polkadot app, or connect a wallet extension in this browser.' };
  const on = Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask)));
  return send('chirp', 'follow', [BigInt(mask), !on]);
}

export async function isFollowing(mask: number): Promise<boolean> {
  const s = await session().catch(() => null);
  if (!s) return false;
  return Boolean(await q(s.chirp, 'follows', s.h160, BigInt(mask)));
}

/* --------------------------------------------------------------- polls */

export type Poll = {
  id: number;
  chirpId: number;
  mask: number;
  closesAt: number;
  options: string[];
  counts: number[];
  total: number;
  /** 0 = you have not voted; otherwise 1 + the index you chose. */
  mine: number;
  open: boolean;
};

const pollCache = new Map<number, Poll | null>();
export function forgetPolls(chirpId?: number) { if (chirpId) pollCache.delete(chirpId); else pollCache.clear(); }

/**
 * The poll on a chirp, if it has one.
 *
 * `null` IS cached, deliberately: most chirps have no poll, and re-asking for
 * every one of them on every render is exactly the read amplification this app
 * has been fighting. A refresh clears the cache, so a poll created a moment ago
 * still shows up within one cycle.
 *
 * A refused read is NOT cached — same rule as everywhere else here. "The chain
 * says there is no poll" and "the chain did not answer" are different facts.
 */
export async function pollOn(chirpId: number): Promise<Poll | null> {
  const hit = pollCache.get(chirpId);
  if (hit !== undefined) return hit;
  const { polls, me } = await handles();
  if (!polls) return null;
  const id = Number((await q(polls, 'pollOfChirp', BigInt(chirpId))) ?? 0);
  if (!id) { pollCache.set(chirpId, null); return null; }

  const raw = await q(polls, 'pollOf', BigInt(id));
  if (raw === undefined) return null;
  const opts = (pick(raw, 'options', 3) ?? []) as unknown[];
  const counts = ((pick(raw, 'counts', 4) ?? []) as unknown[]).map((n) => Number(n));
  const closesAt = Number(pick(raw, 'closesAt', 2) ?? 0);
  const mine = me ? Number((await q(polls, 'votedBy', BigInt(id), me)) ?? 0) : 0;
  const poll: Poll = {
    id,
    chirpId,
    mask: Number(pick(raw, 'mask', 1) ?? 0),
    closesAt,
    options: opts.map((o) => String(o)),
    counts,
    total: Number(pick(raw, 'total', 5) ?? 0),
    mine,
    open: closesAt * 1000 > Date.now(),
  };
  pollCache.set(chirpId, poll);
  return poll;
}

/** Attach a poll to a chirp just posted. Two to four options. */
export async function createPoll(chirpId: number, mask: number, options: string[], minutesOpen: number): Promise<Ok | Fail> {
  const clean = options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
  if (clean.length < 2) return { ok: false, why: 'A poll needs at least two options.' };
  if (clean.some((o) => o.length > 40)) return { ok: false, why: 'Keep each option under 40 characters.' };
  const r = await send('polls', 'create', [BigInt(chirpId), BigInt(mask), clean, minutesOpen]);
  if (r.ok) pollCache.delete(chirpId);
  return r;
}

/** Vote, or move a vote already cast. The contract refuses a closed poll. */
export async function votePoll(pollId: number, chirpId: number, option: number): Promise<Ok | Fail> {
  const r = await send('polls', 'vote', [BigInt(pollId), option]);
  if (r.ok) pollCache.delete(chirpId);
  return r;
}

/* ---------------------------------------------------------------- rules */

export const REPLY_EVERYONE = 0;
export const REPLY_FOLLOWING = 1;
export const REPLY_MENTIONED = 2;

export type Rules = { policy: number; blocks: number };

const rulesCache = new Map<number, Rules>();
const blockCache = new Map<string, boolean>();
export function forgetRules() { rulesCache.clear(); blockCache.clear(); }

export async function rulesFor(mask: number): Promise<Rules> {
  const hit = rulesCache.get(mask);
  if (hit) return hit;
  const { rules } = await handles();
  const raw = rules ? await q(rules, 'rulesFor', BigInt(mask)) : undefined;
  if (raw === undefined) return { policy: REPLY_EVERYONE, blocks: 0 };
  const r: Rules = { policy: Number(pick(raw, 'policy', 0) ?? 0), blocks: Number(pick(raw, 'blocks', 1) ?? 0) };
  rulesCache.set(mask, r);
  return r;
}

/** Is the conversation between these two off, in either direction? */
export async function isBlocked(a: number, b: number): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const key = a < b ? a + ':' + b : b + ':' + a;   // symmetric: one entry serves both
  const hit = blockCache.get(key);
  if (hit !== undefined) return hit;
  const { rules } = await handles();
  const v = rules ? await q(rules, 'eitherBlocked', BigInt(a), BigInt(b)) : undefined;
  if (v === undefined) return false;
  blockCache.set(key, Boolean(v));
  return Boolean(v);
}

export async function setReplyPolicy(mask: number, policy: number): Promise<Ok | Fail> {
  const r = await send('rules', 'setReplyPolicy', [BigInt(mask), policy]);
  if (r.ok) rulesCache.delete(mask);
  return r;
}

export async function setBlocked(mask: number, other: number, on: boolean): Promise<Ok | Fail> {
  const r = await send('rules', 'setBlocked', [BigInt(mask), BigInt(other), on]);
  if (r.ok) { rulesCache.delete(mask); blockCache.clear(); }
  return r;
}

/**
 * May this mask reply to this chirp, by the author's published rule?
 *
 * Honest about what it is: A CHECK A CLIENT CHOOSES TO MAKE. Chirp2 predates
 * ChirpRules and has no hook, so somebody who ignores this can post the reply
 * anyway and the chain will take it. What the rule buys is that it is public
 * and unforgeable — only the mask holder can set it, and any reader can check
 * whether a client respected it. That is worth having, and it is not the same
 * as being impossible, so the app never claims it is.
 */
export async function mayReply(post: Post, who: number): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!who || who === post.mask) return { ok: true };
  if (await isBlocked(post.mask, who)) {
    return { ok: false, why: 'One of you blocked the other, so this reply would be hidden from them.' };
  }
  const { policy } = await rulesFor(post.mask);
  if (policy === REPLY_EVERYONE) return { ok: true };
  if (policy === REPLY_MENTIONED) {
    const named = new Set((post.body.match(/@([A-Za-z0-9_.-]{1,32})/g) ?? []).map((m) => m.slice(1).toLowerCase()));
    const w = await whoOf((await handles()).masks, who);
    return named.has((w.handle || '').toLowerCase())
      ? { ok: true }
      : { ok: false, why: 'The author asked that only the people they named can reply.' };
  }
  const { chirp } = await handles();
  const on = Boolean(await q(chirp, 'follows', post.author, BigInt(who)));
  return on ? { ok: true } : { ok: false, why: 'The author asked that only people they follow can reply.' };
}

/* ---------------------------------------------------------------- media */

const mediaCache = new Map<number, { url: string; alt: string } | null>();
export function forgetMedia(chirpId?: number) { if (chirpId) mediaCache.delete(chirpId); else mediaCache.clear(); }
export const MEDIA_MAX = 24_000;

/** The picture attached to a chirp. `null` means the chain said there is none. */
export async function mediaOf(chirpId: number, author: number): Promise<{ url: string; alt: string } | null> {
  const hit = mediaCache.get(chirpId);
  if (hit !== undefined) return hit;
  const { media } = await handles();
  if (!media) return null;
  const info = await q(media, 'infoOf', BigInt(chirpId));
  if (info === undefined) return null;
  const size = Number(pick(info, 'size', 0) ?? 0);
  const by = Number(pick(info, 'mask', 1) ?? 0);
  const alt = String(pick(info, 'alt', 2) ?? '');
  // Attached by somebody other than the chirp's author: ignore it. The contract
  // cannot read Chirp2's storage to check who wrote the post, so the check has
  // to live here — otherwise anyone could hang a picture on anyone's chirp.
  if (!size || (author && by && by !== author)) { mediaCache.set(chirpId, null); return null; }

  const raw = await q(media, 'mediaOf', BigInt(chirpId));
  const hex = typeof raw === 'string' ? raw : (raw as { asHex?: () => string })?.asHex?.() ?? '';
  if (!hex || hex === '0x') return null;
  const url = 'data:image/webp;base64,' + btoa(
    (hex.slice(2).match(/../g) ?? []).map((b) => String.fromCharCode(parseInt(b, 16))).join(''),
  );
  const got = { url, alt };
  mediaCache.set(chirpId, got);
  return got;
}

export async function attachMedia(chirpId: number, mask: number, bytes: Uint8Array, alt: string): Promise<Ok | Fail> {
  if (!bytes.length) return { ok: false, why: 'Nothing to attach.' };
  if (bytes.length > MEDIA_MAX) {
    return { ok: false, why: 'That picture is ' + Math.round(bytes.length / 1000) + ' kB; the limit is 24 kB.' };
  }
  const hex = '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const r = await send('media', 'attach', [BigInt(chirpId), BigInt(mask), hex, alt.slice(0, 120)]);
  if (r.ok) mediaCache.delete(chirpId);
  return r;
}

export async function detachMedia(chirpId: number, mask: number): Promise<Ok | Fail> {
  const r = await send('media', 'detach', [BigInt(chirpId), BigInt(mask)]);
  if (r.ok) mediaCache.delete(chirpId);
  return r;
}
