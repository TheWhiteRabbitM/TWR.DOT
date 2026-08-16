import { useCallback, useEffect, useState } from 'react';
import { isInsideContainer, getAccountsProvider } from '@parity/product-sdk/host';
import {
  createContract,
  createContractRuntimeFromClient,
  ensureContractAccountMapped,
} from '@parity/product-sdk/contracts';
import { ss58Encode, deriveH160 } from '@parity/product-sdk/address';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { App } from '@parity/product-sdk/core';
import { MARKET, maskOf } from './chain';
import { MARKET_ABI } from './abi';

/**
 * Signing, for both sides of the market.
 *
 * Reading needs nobody; every signed path needs the user's keys, which live in
 * the Polkadot app. Outside it this reports why and everything else still works.
 *
 * FIVE TRAPS, ALL PAID FOR ELSEWHERE FIRST. Three are documented in
 * thebutton/src/lib/signer.ts and two in dotmail/src/names.ts; taking them from
 * there cost a read and saved rediscovering each one against real money.
 *   1. SignerManager never reaches the user's keys inside the host — it returns
 *      an app-scoped account that starts empty. Ask the accounts provider.
 *   2. Account mapping submits its own transaction, so it runs lazily on the
 *      first write rather than at load.
 *   3. getLegacyAccounts returns a neverthrow ResultAsync, not a promise: the
 *      failure case has to be matched rather than caught.
 *   4. GAS MUST BE EXPLICIT. The SDK's sizing dry run comes back short and the
 *      call reverts BEFORE the wallet sheet is raised, so the user sees a
 *      refusal without ever being asked to sign.
 *   5. A write that returns ok and changed nothing has happened on this chain
 *      before, so callers read back rather than trust a receipt.
 *
 * And an H160 comes off a public key by a HASH, not by truncating it — hence
 * deriveH160 rather than a slice.
 */

const TIMEOUT_MS = 20_000;
const SIGN_MS = 90_000;

/** See trap 4. Ceilings, not charges: an unused ceiling costs nothing. */
const WEIGHTS = {
  gasLimit: { ref_time: 900_000_000_000n, proof_size: 2_000_000n },
  storageDepositLimit: 10n ** 18n,
};

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);

export type TradeStatus =
  | { phase: 'unavailable'; why: string }
  | { phase: 'ready' }
  | { phase: 'working'; step: string }
  | { phase: 'done'; what: string }
  | { phase: 'failed'; message: string };

export interface Trader {
  status: TradeStatus;
  address: string | null;
  /** The visitor's mask. Zero means they cannot buy or sell yet. */
  mask: bigint;
  buy: (listingId: number, price: bigint, sealed: string) => Promise<void>;
  list: (item: {
    title: string; price: bigint; stock: number; digital: boolean;
    descCid: string; imageCid: string; payloadCid: string; keyCommit: string;
  }) => Promise<void>;
  act: (fn: 'confirm' | 'dispute' | 'deliver' | 'ship', orderId: number, arg?: string) => Promise<void>;
  reset: () => void;
}

export function useTrader(app: App | null): Trader {
  const [status, setStatus] = useState<TradeStatus>({
    phase: 'unavailable',
    why: 'checking for a wallet…',
  });
  const [account, setAccount] = useState<{ address: string; signer: unknown } | null>(null);
  const [mask, setMask] = useState<bigint>(0n);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const inside = await Promise.resolve(isInsideContainer()).catch(() => false);
      if (!alive) return;
      if (!inside) {
        setStatus({
          phase: 'unavailable',
          why: 'open this in the Polkadot app to buy or sell — browsing works anywhere',
        });
        return;
      }
      if (!app) {
        setStatus({ phase: 'unavailable', why: 'sdk not ready' });
        return;
      }
      try {
        const provider = await withTimeout(getAccountsProvider(), TIMEOUT_MS, 'accounts provider');
        if (!provider) {
          setStatus({ phase: 'unavailable', why: 'the host exposed no accounts provider' });
          return;
        }
        const accounts = await provider.getLegacyAccounts().match(
          (list) => list,
          () => [],
        );
        if (!alive) return;
        const first = accounts[0];
        if (!first) {
          setStatus({ phase: 'unavailable', why: 'the host exposed no wallet accounts' });
          return;
        }
        const address = ss58Encode(first.publicKey);
        const signer = provider.getLegacyAccountSigner({ publicKey: first.publicKey });
        setAccount({ address, signer });

        // The mask is read over ethers, from the H160 the contract will see —
        // not from the SS58 address, which the mask registry has never heard of.
        const found = await maskOf(deriveH160(first.publicKey)).catch(() => 0n);
        if (!alive) return;
        setMask(found);
        setStatus(
          found === 0n
            ? {
                phase: 'unavailable',
                why: 'claim a Peoplebook mask first — it is the identity this market buys and sells under, and where a seller seals your delivery to',
              }
            : { phase: 'ready' },
        );
      } catch (err) {
        if (!alive) return;
        setStatus({ phase: 'unavailable', why: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [app]);

  /** Build the contract handle, mapping the account first — see trap 2. */
  const bind = useCallback(async () => {
    if (!app || !account) throw new Error('no wallet account to sign with');
    const client = app.chain.getRawClient(devnet_asset_hub);
    const runtime = createContractRuntimeFromClient(client, devnet_asset_hub);
    setStatus({ phase: 'working', step: 'mapping your account' });
    const mapped = await withTimeout(
      ensureContractAccountMapped(runtime, account.address, account.signer as never),
      TIMEOUT_MS,
      'account mapping',
    );
    if (mapped && 'ok' in mapped && !mapped.ok) {
      throw new Error(`account mapping failed: ${String(mapped.error)}`);
    }
    // `defaultSigner` is the option createContract reads; a plain `{ signer }`
    // leaves every .tx() with no signer at all and no error to say so.
    return createContract(runtime, MARKET, MARKET_ABI, { defaultSigner: account.signer as never });
  }, [app, account]);

  const buy = useCallback(
    async (listingId: number, price: bigint, sealed: string) => {
      try {
        const c = await bind();
        setStatus({ phase: 'working', step: 'waiting for your signature' });
        await withTimeout(
          c.buy.tx(BigInt(listingId), sealed as never, { ...WEIGHTS, value: price }),
          SIGN_MS,
          'purchase',
        );
        setStatus({ phase: 'done', what: `paid for listing #${listingId}` });
      } catch (e) {
        setStatus({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [bind],
  );

  const list = useCallback(
    async (item: Parameters<Trader['list']>[0]) => {
      if (mask === 0n) {
        setStatus({ phase: 'failed', message: 'you need a mask to sell' });
        return;
      }
      try {
        const c = await bind();
        setStatus({ phase: 'working', step: 'waiting for your signature' });
        await withTimeout(
          c.list.tx(
            mask,
            item.title,
            item.descCid,
            item.imageCid,
            item.payloadCid,
            item.keyCommit as never,
            item.price,
            item.stock,
            item.digital,
            WEIGHTS,
          ),
          SIGN_MS,
          'listing',
        );
        setStatus({ phase: 'done', what: `${item.title} is on sale` });
      } catch (e) {
        setStatus({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [bind, mask],
  );

  const act = useCallback(
    async (fn: 'confirm' | 'dispute' | 'deliver' | 'ship', orderId: number, arg = '') => {
      try {
        const c = await bind();
        setStatus({ phase: 'working', step: 'waiting for your signature' });
        const args: unknown[] =
          fn === 'confirm' ? [BigInt(orderId)] : [BigInt(orderId), arg as never];
        await withTimeout(
          (c as Record<string, { tx: (...a: unknown[]) => Promise<unknown> }>)[fn].tx(
            ...args,
            WEIGHTS,
          ),
          SIGN_MS,
          fn,
        );
        setStatus({ phase: 'done', what: `${fn} sent for order #${orderId}` });
      } catch (e) {
        setStatus({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [bind],
  );

  const reset = useCallback(() => {
    if (account && mask !== 0n) setStatus({ phase: 'ready' });
  }, [account, mask]);

  return { status, address: account?.address ?? null, mask, buy, list, act, reset };
}
