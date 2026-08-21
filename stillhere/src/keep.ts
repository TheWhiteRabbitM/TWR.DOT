/**
 * Putting a pixel down.
 *
 * Reading the canvas needs nobody: it is contract storage, and anyone can read
 * it. Placing needs the wallet inside the Polkadot app and a mask you actually
 * hold, because the whole point of this board is that one human gets one pixel.
 *
 * The signing chain is the one proven in the forum, and it is not simple for
 * good reasons. The host hands back an empty legacy account list in the web
 * shell, so there is a SignerManager fallback scoped to peoplebook.dot; and the
 * account you sign with is sometimes only a proxy delegate for the account that
 * holds the mask, so a Proxy.proxy wrapper carries the call for it.
 */
import type { AbiEntry } from '@parity/product-sdk-contracts';
import { STILLHERE } from './chain';

/** Ceilings, not charges — an unused gas ceiling costs nothing (chirp/amazdot
 *  sign with these). */
const WEIGHTS = {
  gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n },
  storageDepositLimit: 10n ** 18n,
};

/** JSON ABI for the SDK write factory — it wants AbiEntry[], not the
 *  human-readable string form ethers reads with. */
const WRITE_ABI: AbiEntry[] = [
  {
    type: 'function', name: 'start', stateMutability: 'nonpayable',
    inputs: [
      { name: 'mask', type: 'uint256' },
      { name: 'label', type: 'string' },
      { name: 'message', type: 'string' },
      { name: 'window', type: 'uint64' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  { type: 'function', name: 'checkIn', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
];

async function retryImport<T>(load: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await load();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

/** The host's accounts provider can hang instead of answering — the wallet
 *  bridge stalls and nothing rejects. amazdot/trade.ts and dotdirectory/register.ts
 *  both learned to race it against a clock so the UI never sits on "checking…"
 *  forever. Same clock guards the mask reads so a slow RPC can't masquerade as
 *  "no mask". */
const CONNECT_MS = 20_000;
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)),
  ]);

/** Two account shapes. Legacy = the user's real wallet accounts, but in the web
 *  shell this list is often EMPTY (a host derivation bug — chirp/DEVFEEDBACK #18).
 *  App = the SignerManager account scoped to the Peoplebook identity, which owns
 *  the mask and whose signer actually raises the wallet sheet. Chirp tries legacy,
 *  then falls back to the SignerManager account, so the forum does the same. */
interface HostAccountsLike {
  getLegacyAccounts(): PromiseLike<{ value?: { publicKey: Uint8Array; name?: string }[] }>;
  getLegacyAccountSigner(a: { publicKey: Uint8Array; name?: string }): unknown;
}
interface SignerAccountLike {
  address: string;
  h160Address: `0x${string}`;
  publicKey: Uint8Array;
  name?: string | null;
  getSigner(): unknown;
}
interface SignerManagerLike {
  connect(signal?: AbortSignal): Promise<unknown>;
  getState(): { accounts: readonly SignerAccountLike[]; selectedAccount: SignerAccountLike | null };
}

/** The SignerManager is scoped to the Peoplebook IDENTITY app, not the forum —
 *  that is the account that holds the mask and that chirp signs with. */
const IDENTITY_DAPP = 'peoplebook.dot';
const ACCOUNT_MS = 8_000;

const h160Of = (pk: Uint8Array, derive: (pk: Uint8Array) => unknown): string => {
  const raw = derive(pk) as unknown;
  return typeof raw === 'string'
    ? raw
    : `0x${[...(raw as Uint8Array)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';
const MASK_RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];
/** Read the mask (and its profile) for an H160 over ethers. `answered` tells a
 *  real "no mask" (mask 0 from a live RPC) apart from "no RPC answered" so the
 *  UI can retry instead of wrongly saying you have none. */
async function readMask(
  h160: string,
): Promise<{ mask: bigint; displayName: string; verified: string; answered: boolean }> {
  const { Contract, JsonRpcProvider } = await import('ethers');
  const ABI = [
    'function maskOf(address) view returns (uint256)',
    'function profileOf(uint256) view returns (string displayName, string telegram, string x, string bio)',
    'function verifiedName(uint256) view returns (string)',
  ];
  for (const url of MASK_RPCS) {
    try {
      const reg = new Contract(MASKS, ABI, new JsonRpcProvider(url, undefined, { staticNetwork: true }));
      const mask: bigint = await withTimeout(reg.maskOf(h160), CONNECT_MS, 'the mask registry');
      let displayName = '';
      let verified = '';
      if (mask !== 0n) {
        const [p, v] = await Promise.all([reg.profileOf(mask).catch(() => null), reg.verifiedName(mask).catch(() => '')]);
        displayName = p?.displayName || `mask #${mask}`;
        verified = v || '';
      }
      return { mask, displayName, verified, answered: true };
    } catch {
      /* next RPC */
    }
  }
  return { mask: 0n, displayName: '', verified: '', answered: false };
}

/** The SDK app instance (chain client + runtime), created once and shared by the
 *  proxy lookup and the write path. */
let appPromise: Promise<AppLike> | null = null;
interface AppLike {
  chain: { getClient(d: unknown): unknown; getRawClient(d: unknown): unknown };
}
function getApp(): Promise<AppLike> {
  appPromise ??= (async () => {
    const { createApp } = await retryImport(() => import('@parity/product-sdk/core'));
    const app = (await createApp({ name: 'blockcanvas', cloudStorage: false })) as AppLike;
    // createApp does NOT open the chain connection — getClient/getRawClient throw
    // "Chain not connected · call createChainClient() first" until we do. Open the
    // devnet asset hub once here so the proxy lookup AND the write both work.
    const { createChainClient } = await retryImport(() => import('@parity/product-sdk/chain'));
    const { devnet_asset_hub } = await retryImport(() => import('@parity/product-sdk-descriptors/devnet-asset-hub'));
    await createChainClient({ chains: { assetHub: devnet_asset_hub } });
    return app;
  })().catch((e) => {
    appPromise = null;
    throw e;
  });
  return appPromise;
}

/** chirp's proxy resolution. In the web shell the account you SIGN with is often
 *  a delegate for your real identity account (the one that holds the mask). Find
 *  the account that `delegate` is a proxy for — but only when it's unambiguous
 *  (one delegator), else stay yourself. */
async function proxiedAccount(api: unknown, delegate: string): Promise<string | null> {
  try {
    const q = (api as { query: { Proxy: { Proxies: { getEntries(): Promise<unknown[]> } } } }).query.Proxy.Proxies;
    const rows = (await withTimeout(q.getEntries(), 15_000, 'proxies')) as {
      keyArgs?: unknown[];
      value?: [{ delegate?: unknown }[]?];
    }[];
    const mine = rows.filter((e) => (e?.value?.[0] ?? []).some((d) => String(d?.delegate) === delegate));
    return mine.length === 1 ? String(mine[0]?.keyArgs?.[0] ?? '') || null : null;
  } catch {
    return null;
  }
}

export interface Signer {
  address: string;
  mask: bigint;
  displayName: string;
  verified: string;
  /** The real identity account this signer is a proxy delegate for, when the
   *  signer itself is only a delegate. null = the signer's own account holds the
   *  mask (direct write). */
  real: string | null;
  /** Bind the board to this signer. `write` submits a contract call directly, or
   *  wrapped in Proxy.proxy(real, …) when `real` is set. */
  board(): Promise<{ write(method: string, args: unknown[]): Promise<string> }>;
}

/**
 * Resolve the wallet + its mask, ready to write. Returns null when there is no
 * host (browsing outside the Polkadot app), 'nowallet' when the host exposed no
 * account, 'nomask' when the account has no Peoplebook mask. Only the object
 * form can post.
 */
export async function connectSigner(
  full = false,
): Promise<Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout'> {
  let host;
  try {
    host = await retryImport(() => import('@parity/product-sdk/host'));
  } catch {
    return 'nohost';
  }
  const inside = await Promise.resolve(host.isInsideContainer()).catch(() => false);
  if (!inside) return 'nohost';

  const { ss58Encode, deriveH160, ss58ToH160 } = await retryImport(() => import('@parity/product-sdk/address'));
  let address = '';
  let h160 = '';
  let signer: unknown = null;

  // 1) Legacy accounts — the user's real wallet. Best case, but in the web shell
  //    this list is often EMPTY (host derivation bug), so it is a first try only.
  try {
    const ap = (await withTimeout(
      Promise.resolve(host.getAccountsProvider()),
      CONNECT_MS,
      'the wallet',
    )) as HostAccountsLike | null;
    if (ap) {
      const r = (await withTimeout(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts')) as {
        value?: { publicKey: Uint8Array; name?: string }[];
      };
      const a = (r?.value ?? []).find((x) => x?.publicKey);
      if (a) {
        address = ss58Encode(a.publicKey);
        h160 = h160Of(a.publicKey, deriveH160);
        signer = ap.getLegacyAccountSigner({ publicKey: a.publicKey, name: a.name });
      }
    }
  } catch {
    /* fall through to the SignerManager fallback */
  }

  // The mask on the legacy account, if any.
  let m = signer ? await readMask(h160) : { mask: 0n, displayName: '', verified: '', answered: false };

  // 2) THE MASK USUALLY LIVES ON THE PEOPLEBOOK IDENTITY ACCOUNT, not on the
  //    web-shell/legacy account the host hands back first (that one is often a
  //    maskless delegate — the "no mask" you saw despite holding one). So when
  //    the legacy account carries no mask, resolve the Peoplebook account via
  //    SignerManager and PREFER it when it actually holds a mask. Gated on
  //    `full`: connect() raises the host permission sheet, so this only runs on a
  //    deliberate login/post, never on a passive page read. (chirp's workaround.)
  if (full && m.mask === 0n) {
    try {
      const signerPkg = (await retryImport(() => import('@parity/product-sdk-signer'))) as {
        SignerManager: new (o: { dappName: string }) => SignerManagerLike;
      };
      const manager = new signerPkg.SignerManager({ dappName: IDENTITY_DAPP });
      await withTimeout(manager.connect(), CONNECT_MS, 'the wallet').catch(() => undefined);
      const deadline = Date.now() + ACCOUNT_MS;
      for (;;) {
        const st = manager.getState();
        const acc = st.selectedAccount ?? st.accounts[0] ?? null;
        if (acc) {
          const pbH160 = acc.h160Address || h160Of(acc.publicKey, deriveH160);
          const pm = await readMask(pbH160);
          // Prefer the Peoplebook account when it holds a mask, or when we had no
          // signer at all (so there is still something to sign with).
          if (pm.mask > 0n || !signer) {
            address = acc.address;
            h160 = pbH160;
            signer = acc.getSigner();
            m = pm;
          }
          break;
        }
        if (Date.now() > deadline) break;
        await new Promise((res) => setTimeout(res, 250));
      }
    } catch {
      /* no account available */
    }
  }

  // 3) PROXY (chirp). If neither the legacy nor the Peoplebook account holds a
  //    mask, the signer may be a DELEGATE for the real identity account (the mask
  //    holder). Resolve that via Proxy.Proxies, read the mask there, and remember
  //    `real` so writes go through Proxy.proxy(real, …) — then the contract sees
  //    the real account as msg.sender and the mask gate passes.
  let real: string | null = null;
  if (full && m.mask === 0n && signer) {
    try {
      const { devnet_asset_hub } = await retryImport(() => import('@parity/product-sdk-descriptors/devnet-asset-hub'));
      const api = (await getApp()).chain.getClient(devnet_asset_hub);
      const found = await proxiedAccount(api, address);
      if (found) {
        const rm = await readMask(ss58ToH160(found));
        if (rm.mask > 0n) {
          real = found;
          m = rm;
        }
      }
    } catch {
      /* no proxy / chain unreachable — falls through to nomask */
    }
  }

  if (!signer || !h160) return 'nowallet';
  if (!m.answered) return 'timeout';
  // A PASSIVE read only saw the legacy account. Its lack of a mask is NOT proof
  // you have none — your mask usually lives on the Peoplebook/identity account,
  // which is only checked on a deliberate login (full). So passively, ask the
  // user to log in rather than dead-ending on "no mask". Only a FULL connect
  // (which also tried SignerManager + the proxy) may conclude a real 'nomask'.
  if (m.mask === 0n) return full ? 'nomask' : 'nowallet';
  const { mask, displayName, verified } = m;

  const board = async () => {
    const { createContract, createContractRuntimeFromClient, ensureContractAccountMapped } = await retryImport(
      () => import('@parity/product-sdk/contracts'),
    );
    const { devnet_asset_hub } = await retryImport(() => import('@parity/product-sdk-descriptors/devnet-asset-hub'));
    const app = await getApp();
    const runtime = createContractRuntimeFromClient(app.chain.getRawClient(devnet_asset_hub) as never, devnet_asset_hub);
    await ensureContractAccountMapped(runtime, address, signer as never);
    const c = createContract(runtime, STILLHERE, WRITE_ABI, { defaultSigner: signer as never }) as Record<
      string,
      {
        tx: (...a: unknown[]) => Promise<{ txHash?: string }>;
        prepare: (...a: unknown[]) => unknown;
      }
    >;
    const write = async (method: string, args: unknown[]): Promise<string> => {
      // Direct: the signer's own account owns the mask.
      if (!real) {
        const tx = await c[method].tx(...args, WEIGHTS);
        return String(tx?.txHash ?? '');
      }
      // Proxy: build the contract call, wrap it in Proxy.proxy(real, …), and sign
      // as the delegate — the runtime executes it AS `real`, the mask owner.
      const api = app.chain.getClient(devnet_asset_hub) as {
        tx: {
          Proxy: {
            proxy: (
              real: string,
              force: unknown,
              call: unknown,
            ) => { signAndSubmit: (s: unknown) => Promise<{ txHash?: string }> };
          };
        };
      };
      const prepared = (await c[method].prepare(...args, WEIGHTS)) as {
        decodedCall?: unknown;
        value?: { decodedCall?: unknown };
      };
      const call = prepared?.decodedCall ?? prepared?.value?.decodedCall;
      const res = await api.tx.Proxy.proxy(real, 'Any', call).signAndSubmit(signer);
      return String(res?.txHash ?? '');
    };
    return { write };
  };

  return { address, mask, displayName, verified, real, board };
}

type Conn = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout';

/** Cached across the app. A PASSIVE getSigner() (full=false) reads only legacy
 *  accounts — no wallet sheet, so a page load never prompts. An INTERACTIVE
 *  getSigner(true) — the login button, a reply, a like — runs the SignerManager
 *  path that raises the host permission sheet, and reuses an already-signed-in
 *  result so it never re-prompts once connected. */
let signerCache: Promise<Conn> | null = null;
export function getSigner(full = false): Promise<Conn> {
  if (full) {
    const prev = signerCache;
    signerCache = (async () => {
      const s = await prev?.catch(() => null);
      if (s && typeof s === 'object') return s; // already signed in — no re-prompt
      return connectSigner(true);
    })();
  } else {
    signerCache ??= connectSigner(false);
  }
  const active = signerCache;
  return active
    .then((s) => {
      // A stalled connect is retryable — don't pin it in the cache.
      if (s === 'timeout' && signerCache === active) signerCache = null;
      return s;
    })
    .catch((e) => {
      if (signerCache === active) signerCache = null;
      throw e;
    });
}
export function resetSigner() {
  signerCache = null;
}

/* ------------------------------------------------------------- actions ---- */

export async function startWatch(s: Signer, label: string, message: string, window: number) {
  const b = await s.board();
  return b.write('start', [s.mask, label, message, BigInt(window)]);
}
/** Still here. Resets the clock. */
export async function checkIn(s: Signer, id: number) {
  const b = await s.board();
  return b.write('checkIn', [BigInt(id)]);
}
export async function endWatch(s: Signer, id: number) {
  const b = await s.board();
  return b.write('cancel', [BigInt(id)]);
}
