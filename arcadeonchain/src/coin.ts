/**
 * The coin mechanism.
 *
 * WHY A PAYMENT AND NOT A BUTTON
 *   An arcade machine that starts when you touch it is a demo. The coin was the
 *   whole social contract of the room: it cost something, so a go mattered, and
 *   the machine owed you a fair one. This one takes PAS on the devnet — a real
 *   signed transfer to the arcade's own account, watched into a block before the
 *   credit lands. Nothing here simulates a payment.
 *
 * WHY THE WHOLE THING IS BEHIND A DYNAMIC IMPORT
 *   The chain SDK and the Asset Hub metadata are together larger than both
 *   emulators. Nobody should download them to look at a room. Everything is
 *   imported the first time someone actually reaches for the coin slot.
 *
 * WHAT HAPPENS WITH NO CHAIN AT ALL
 *   Outside the Polkadot shell — a plain browser, our own dev server, the
 *   store's screenshot bot — there is no host and no signer, so there is nothing
 *   to pay with and nothing to pay to. The machine goes to FREE PLAY, which is
 *   what an operator did with a cabinet at a party. It is stated on the cabinet
 *   rather than quietly skipped, because "it charged me nothing" and "it could
 *   not charge me" are different facts.
 */

/** Where the coins go: the arcade's own account, the key that owns the name. */
const TILL = '5GL8hErZeFmqyQHQnZKJzZjsVXfDFAmHU7H9CAM18bPgKQPp';

/** One coin, one credit, one go. */
export const PRICE = 1;

/** Named for the player, not for the protocol — these are what the cabinet says. */
export type CoinStep =
  | 'reaching for the slot'
  | 'waiting for you to sign'
  | 'coin dropping'
  | 'credit'
  ;

export type CoinOutcome =
  | { paid: true; free: false; txHash: string; block: number }
  /** No chain to pay on. The cabinet is on free play and says so. */
  | { paid: true; free: true }
  | { paid: false; why: string; detail?: string };

/** Host calls can queue forever on a wedged channel; nothing here may hang. */
const CONNECT_MS = 12_000;
const ACCOUNT_MS = 8_000;
const TX_MS = 120_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
  ]);
}

/**
 * The connection, made once and kept.
 *
 * A fresh connection per coin would mean two of them racing over the same host
 * provider on a double tap, which The Button's own code warns against in as
 * many words.
 */
let slotPromise: Promise<Slot | null> | null = null;

/**
 * Whose money it is.
 *
 * 'wallet' — one of the player's own accounts, the one that can actually pay.
 * 'app'    — an address the shell derived for arcadeonchain.dot. It exists, it
 *            signs, and it starts empty: nobody has ever put PAS in it and the
 *            player cannot see it in their wallet. Only a fallback, and the
 *            cabinet says so out loud when it is what is paying.
 */
export type PayerKind = 'wallet' | 'app';

type Slot = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any;
  address: string;
  kind: PayerKind;
  name?: string;
  api: {
    tx: { Balances: { transfer_keep_alive: (a: unknown) => unknown } };
    query: { System: { Account: { getValue: (a: string) => Promise<unknown> } } };
  };
  MultiAddress: { Id: (a: string) => unknown };
  /** Planck per PAS, read off the chain rather than assumed. */
  unit: bigint;
  symbol: string;
};

/**
 * Open the coin slot: host, account, chain, and the token's own decimals.
 *
 * Resolves to null when there is nothing to connect to — that is free play, not
 * a failure, and the caller says so on the cabinet.
 *
 * WHY NOT SignerManager
 *   `new SignerManager({ dappName: 'arcadeonchain.dot' })` reads like "connect
 *   the player's wallet" and is not: inside the shell that branch asks for an
 *   APP-SCOPED account the host derives for this product. It is empty, the
 *   player cannot see or fund it from their wallet, and a coin drawn on it dies
 *   with "Inability to pay some fees" — a cabinet that eats a signature and
 *   gives nothing back. So go to the accounts provider directly and pay from
 *   one of the player's REAL accounts; the app-scoped one is a fallback only,
 *   for a host that hands out no wallet accounts at all.
 */
async function openSlot(): Promise<Slot | null> {
  // The host package is small; PAPI and the Asset Hub metadata come to about
  // 1.4 MB between them, and 880 kB of that is the metadata alone. Asking the
  // cheap question first means a plain browser — our own dev server, the
  // store's screenshot bot, anyone outside the shell — never downloads a chain
  // SDK it has nothing to talk to.
  const host = await import('@parity/product-sdk-host');
  const inside = await host.isInsideContainer().catch(() => false);
  if (!inside) return null; // no shell, no wallet, no coin — free play

  const [descriptors, papi] = await Promise.all([
    import('@parity/product-sdk-descriptors/devnet-asset-hub'),
    import('polkadot-api'),
  ]);

  // The provider's lookups answer with a neverthrow ResultAsync — thenable, not
  // a Promise — so this boundary is deliberately untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: any = await withTimeout(host.getAccountsProvider(), CONNECT_MS, 'wallet').catch(() => null);
  if (!ap) return null;
  const ss58 = (pk: Uint8Array) => papi.AccountId().dec(pk) as string;

  // The player's own accounts, before anything else.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wallets: any[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(Promise.resolve(ap.getLegacyAccounts()), ACCOUNT_MS, 'accounts');
    wallets = (r?.value ?? [])
      .filter((a: { publicKey?: Uint8Array }) => a?.publicKey)
      // A LegacyAccount is { publicKey, name? } and carries no address of its own.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((a: any) => ({ ...a, address: ss58(a.publicKey) }));
  } catch {
    wallets = []; // fall through to the app-scoped account
  }

  // The connection has to be the host's own, or the shell raises a "Direct
  // Chain Access" warning at the player mid-game.
  const genesis = (descriptors.devnet_asset_hub as unknown as { genesis: `0x${string}` }).genesis;
  const provider = await withTimeout(host.getHostProvider(genesis), CONNECT_MS, 'chain');
  if (!provider) return null;

  const client = papi.createClient(provider);
  const api = client.getTypedApi(descriptors.devnet_asset_hub) as unknown as Slot['api'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signer: any = null;
  let address = '';
  let kind: PayerKind = 'wallet';
  let name: string | undefined;

  if (wallets.length) {
    const best = await richest(api, wallets);
    address = best.address;
    name = best.name;
    signer = ap.getLegacyAccountSigner({ publicKey: best.publicKey, name: best.name });
  } else {
    // Fallback: the address the host derives for this product. It signs, but it
    // starts empty, so the room has to name it rather than let a coin fail with
    // a revert nobody can act on.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await withTimeout(
        Promise.resolve(ap.getProductAccount('arcadeonchain.dot', 0)),
        ACCOUNT_MS,
        'app account',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pa: any = r?.value;
      const pad = pa ? (pa.address ?? (pa.publicKey ? ss58(pa.publicKey) : '')) : '';
      if (pa && pad) {
        address = pad;
        kind = 'app';
        signer = ap.getProductAccountSigner(pa);
      }
    } catch {
      /* no account at all */
    }
  }
  if (!signer || !address) return null;

  // Decimals come off the chain. Paseo's native balance is ten places and the
  // EVM view of the same chain is eighteen; hardcoding either one is a bug
  // waiting for whichever is wrong, and the difference is a factor of 100
  // million on what a player is charged.
  const spec = await withTimeout(client.getChainSpecData(), CONNECT_MS, 'chain spec');
  const props = (spec as { properties?: { tokenDecimals?: number; tokenSymbol?: string } })
    .properties;
  const decimals = typeof props?.tokenDecimals === 'number' ? props.tokenDecimals : 10;

  return {
    signer,
    address,
    kind,
    name,
    api,
    MultiAddress: (descriptors as unknown as { MultiAddress: Slot['MultiAddress'] }).MultiAddress,
    unit: 10n ** BigInt(decimals),
    symbol: props?.tokenSymbol ?? 'PAS',
  };
}

/**
 * Of the player's accounts, the one that can actually pay.
 *
 * A wallet with six accounts usually has five empty ones; picking the first is
 * a coin refused for no reason the player can see. Balance reads are best
 * effort — if they all fail we take the first, which is the old behaviour.
 */
async function richest<T extends { address: string }>(api: Slot['api'], accounts: T[]): Promise<T> {
  if (accounts.length === 1) return accounts[0];
  try {
    const weighed = await Promise.all(
      accounts.slice(0, 6).map(async (a) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const acc: any = await withTimeout(api.query.System.Account.getValue(a.address), 6_000, 'balance');
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
 * Only a SUCCESSFUL connection is kept.
 *
 * Memoising a failure makes one bad boot permanent: every later coin would get
 * the same dead session back and the room would stay on free play until it was
 * reloaded.
 */
function slot(): Promise<Slot | null> {
  if (!slotPromise) {
    const p = openSlot().catch(() => null);
    slotPromise = p;
    void p.then((s) => {
      if (!s && slotPromise === p) slotPromise = null;
    });
  }
  return slotPromise;
}

/**
 * Who is paying, for the room to say out loud — or null outside the shell,
 * which is free play and needs no name.
 */
export async function payer(): Promise<{ address: string; kind: PayerKind; name?: string } | null> {
  const s = await slot().catch(() => null);
  return s ? { address: s.address, kind: s.kind, name: s.name } : null;
}

/**
 * Start the handshake before anyone presses anything.
 *
 * Called when the room opens. The host handshake takes seconds it can spend
 * while a player is still deciding which cabinet to walk to, and every failure
 * here is rediscovered — and reported — on the coin itself.
 */
export function warmUp(): void {
  void slot();
}

/**
 * Take one coin.
 *
 * Reports every stage, because a signature request that appears in another
 * window with nothing said here reads as a cabinet that ignored you.
 */
export async function insertCoin(onStep: (s: CoinStep) => void): Promise<CoinOutcome> {
  onStep('reaching for the slot');

  let s: Slot | null;
  try {
    s = await slot();
  } catch {
    return { paid: false, why: 'COIN SLOT JAMMED' };
  }
  if (!s) return { paid: true, free: true };

  const signer = s.signer;
  if (!signer) return { paid: false, why: 'NO WALLET' };

  const tx = s.api.tx.Balances.transfer_keep_alive({
    dest: s.MultiAddress.Id(TILL),
    value: BigInt(PRICE) * s.unit,
  });

  const { submitAndWatch, isSigningRejection } = await import('@parity/product-sdk-tx');

  onStep('waiting for you to sign');
  const result = await submitAndWatch(tx as never, signer, {
    waitFor: 'best-block',
    timeoutMs: TX_MS,
    onStatus: (st) => {
      if (st === 'broadcasting') onStep('coin dropping');
      if (st === 'in-block' || st === 'finalized') onStep('credit');
    },
  });

  if (!result.ok) {
    const e = result.error;
    if (isSigningRejection(e)) return { paid: false, why: 'COIN RETURNED', detail: 'you cancelled' };
    const text = String((e as Error)?.message ?? e);
    // The chain says this as a dispatch error, and it is the one failure a
    // player can actually do something about — as long as they are told WHICH
    // pocket is empty. On the app-scoped fallback that is not their wallet.
    if (/InsufficientBalance|Inability to pay|Funds|Payment|TransferFailed|Balance/i.test(text))
      return {
        paid: false,
        why: s.kind === 'app' ? `FUND THE ARCADE ACCOUNT` : `NOT ENOUGH ${s.symbol}`,
        detail:
          s.kind === 'app'
            ? `${s.address} is the address the Polkadot app derived for arcadeonchain — not your wallet. Send it a little ${s.symbol} and try again. (${text})`
            : `${s.address} cannot cover ${PRICE} ${s.symbol} plus the fee. (${text})`,
      };
    return { paid: false, why: 'COIN REJECTED', detail: text };
  }

  const r = result.value;
  if (!r.ok) return { paid: false, why: 'COIN REJECTED', detail: 'the transfer failed on chain' };
  return { paid: true, free: false, txHash: r.txHash, block: r.block.number };
}
