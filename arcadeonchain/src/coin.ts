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
 * A fresh SignerManager per coin would mean two of them racing over the same
 * host provider on a double tap, which The Button's own code warns against in
 * as many words.
 */
let slotPromise: Promise<Slot | null> | null = null;

type Slot = {
  manager: import('@parity/product-sdk-signer').SignerManager;
  account: import('@parity/product-sdk-signer').SignerAccount;
  api: { tx: { Balances: { transfer_keep_alive: (a: unknown) => unknown } } };
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
 */
async function openSlot(): Promise<Slot | null> {
  // The host package is small; the signer, PAPI and the Asset Hub metadata come
  // to about 1.4 MB between them, and 880 kB of that is the metadata alone.
  // Asking the cheap question first means a plain browser — our own dev server,
  // the store's screenshot bot, anyone outside the shell — never downloads a
  // chain SDK it has nothing to talk to.
  const host = await import('@parity/product-sdk-host');
  const inside = await host.isInsideContainer().catch(() => false);
  if (!inside) return null; // no shell, no wallet, no coin — free play

  const [signerPkg, descriptors, papi] = await Promise.all([
    import('@parity/product-sdk-signer'),
    import('@parity/product-sdk-descriptors/devnet-asset-hub'),
    import('polkadot-api'),
  ]);

  const manager = new signerPkg.SignerManager({ dappName: 'arcadeonchain.dot' });
  await withTimeout(manager.connect(), CONNECT_MS, 'wallet').catch(() => undefined);

  // connect() resolves with the account list, but selection happens after it.
  // Waiting is the difference between "no account" and "not yet".
  const deadline = Date.now() + ACCOUNT_MS;
  let account: import('@parity/product-sdk-signer').SignerAccount | null = null;
  for (;;) {
    const s = manager.getState();
    if (s.selectedAccount) {
      account = s.selectedAccount;
      break;
    }
    const first = s.accounts[0];
    if (first) {
      const picked = manager.selectAccount(first.address);
      if (picked.ok) {
        account = picked.value;
        break;
      }
    }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!account) return null;

  // The connection has to be the host's own, or the shell raises a "Direct
  // Chain Access" warning at the player mid-game.
  const genesis = (descriptors.devnet_asset_hub as unknown as { genesis: `0x${string}` }).genesis;
  const provider = await withTimeout(host.getHostProvider(genesis), CONNECT_MS, 'chain');
  if (!provider) return null;

  const client = papi.createClient(provider);
  const api = client.getTypedApi(descriptors.devnet_asset_hub) as unknown as Slot['api'];

  // Decimals come off the chain. Paseo's native balance is ten places and the
  // EVM view of the same chain is eighteen; hardcoding either one is a bug
  // waiting for whichever is wrong, and the difference is a factor of 100
  // million on what a player is charged.
  const spec = await withTimeout(client.getChainSpecData(), CONNECT_MS, 'chain spec');
  const props = (spec as { properties?: { tokenDecimals?: number; tokenSymbol?: string } })
    .properties;
  const decimals = typeof props?.tokenDecimals === 'number' ? props.tokenDecimals : 10;

  return {
    manager,
    account,
    api,
    MultiAddress: (descriptors as unknown as { MultiAddress: Slot['MultiAddress'] }).MultiAddress,
    unit: 10n ** BigInt(decimals),
    symbol: props?.tokenSymbol ?? 'PAS',
  };
}

function slot(): Promise<Slot | null> {
  if (!slotPromise) slotPromise = openSlot().catch(() => null);
  return slotPromise;
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

  const signer = s.manager.getSigner();
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
    // player can actually do something about.
    if (/InsufficientBalance|Funds|Payment/i.test(text))
      return { paid: false, why: `NOT ENOUGH ${s.symbol}`, detail: text };
    return { paid: false, why: 'COIN REJECTED', detail: text };
  }

  const r = result.value;
  if (!r.ok) return { paid: false, why: 'COIN REJECTED', detail: 'the transfer failed on chain' };
  return { paid: true, free: false, txHash: r.txHash, block: r.block.number };
}
