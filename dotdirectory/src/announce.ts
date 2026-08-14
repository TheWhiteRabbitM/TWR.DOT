import { useCallback, useEffect, useState } from 'react';
import { isInsideContainer, getAccountsProvider } from '@parity/product-sdk/host';
import {
  createContract,
  createContractRuntimeFromClient,
  ensureContractAccountMapped,
  QUERY_FALLBACK_ORIGIN,
} from '@parity/product-sdk/contracts';
import { ss58Encode } from '@parity/product-sdk/address';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { App } from '@parity/product-sdk/core';
import { DIRECTORY } from './chain';
import { DIRECTORY_ABI } from './abi';

/**
 * Announcing a name from the page.
 *
 * This is the piece that makes the directory independent. Everything else here
 * reads, and reading needs nobody: the list, the owners, the records and the
 * arrival blocks all come off a public RPC in any browser. But a name only
 * enters the directory when someone calls announce(), and until now that meant
 * a script and a mnemonic — which left the list seeded from dotmetrics' snapshot
 * and going stale the moment that indexer stalled, as it did on 10 August.
 *
 * With this, whoever registers a `.dot` can put it in the directory themselves,
 * and anyone can do it for anyone else: the contract admits a label only if the
 * registry gives it an owner, so announcing someone's name is a favour rather
 * than an attack.
 *
 * WHAT ONLY WORKS INSIDE THE HOST
 * Signing needs the user's keys, which live in the Polkadot App. Outside it the
 * page still works completely — it simply cannot write. That asymmetry is
 * deliberate: a directory nobody can read without a wallet would be worse than
 * one nobody can write to without one.
 *
 * THREE TRAPS, ALL DOCUMENTED IN thebutton/src/lib/signer.ts AND HIT THERE FIRST
 *   1. SignerManager never reaches the user's keys inside the host — it returns
 *      an app-scoped account the host derives, which starts empty and is not in
 *      the wallet UI. The accounts provider is asked directly instead.
 *   2. Read-only dry runs must NOT use the user's origin: pallet-revive rejects
 *      an unmapped account with AccountUnmapped, and a fresh account is always
 *      unmapped. QUERY_FALLBACK_ORIGIN is the pallet's own mapped account.
 *   3. Account mapping submits its own transaction, so it runs lazily on the
 *      first announce rather than at load — making a read-only page wait on a
 *      signature is how thebutton's UI ended up stuck on "reading register".
 */

const TIMEOUT_MS = 20_000;

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);

export type AnnounceStatus =
  | { phase: 'unavailable'; why: string }
  | { phase: 'ready'; address: string }
  | { phase: 'working'; step: string }
  | { phase: 'done'; label: string }
  | { phase: 'failed'; message: string };

export interface Announcer {
  status: AnnounceStatus;
  announce: (label: string) => Promise<void>;
  reset: () => void;
}

export function useAnnouncer(app: App | null): Announcer {
  const [status, setStatus] = useState<AnnounceStatus>({
    phase: 'unavailable',
    why: 'checking for a wallet…',
  });
  const [account, setAccount] = useState<{ address: string; signer: unknown } | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const inside = await Promise.resolve(isInsideContainer()).catch(() => false);
      if (!alive) return;
      if (!inside) {
        setStatus({
          phase: 'unavailable',
          why: 'open this in the Polkadot app to announce a name — reading works anywhere',
        });
        return;
      }
      if (!app) {
        setStatus({ phase: 'unavailable', why: 'sdk not ready' });
        return;
      }

      try {
        // Straight to the accounts provider: see trap 1 above.
        const provider = await withTimeout(getAccountsProvider(), TIMEOUT_MS, 'accounts provider');
        if (!provider) {
          setStatus({ phase: 'unavailable', why: 'the host exposed no accounts provider' });
          return;
        }

        // getLegacyAccounts returns a neverthrow ResultAsync, not a promise:
        // awaiting it yields a Result, and the failure case has to be matched
        // rather than caught.
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

        // A HostAccount carries the raw public key, not an address — the SS58
        // form is derived from it. The signer likewise comes from the public key
        // alone; `name` is accepted for ergonomics and ignored.
        const address = ss58Encode(first.publicKey);
        const signer = provider.getLegacyAccountSigner({ publicKey: first.publicKey });
        setAccount({ address, signer });
        setStatus({ phase: 'ready', address });
      } catch (err) {
        if (!alive) return;
        setStatus({
          phase: 'unavailable',
          why: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [app]);

  const announce = useCallback(
    async (raw: string) => {
      const label = raw.trim().toLowerCase().replace(/\.dot$/, '');
      if (!label) return;
      if (!app || !account) {
        setStatus({ phase: 'failed', message: 'no wallet account to sign with' });
        return;
      }

      try {
        setStatus({ phase: 'working', step: 'preparing' });
        const client = app.chain.getRawClient(devnet_asset_hub);
        const runtime = createContractRuntimeFromClient(client, devnet_asset_hub);
        // `defaultSigner` is the option createContract actually reads; a plain
        // `{ signer }` leaves every .tx() with no signer at all.
        const contract = createContract(runtime, DIRECTORY, DIRECTORY_ABI, {
          defaultSigner: account.signer as never,
        });

        // Check before spending a signature on a certain revert.
        setStatus({ phase: 'working', step: 'checking the registry' });
        const owner = await withTimeout(
          contract.ownerOfLabel.query(label, { origin: QUERY_FALLBACK_ORIGIN }),
          TIMEOUT_MS,
          'registry read',
        );
        if (!owner || /^0x0+$/.test(String(owner))) {
          setStatus({ phase: 'failed', message: `${label}.dot is not registered` });
          return;
        }
        const listed = await withTimeout(
          contract.isListed.query(label, { origin: QUERY_FALLBACK_ORIGIN }),
          TIMEOUT_MS,
          'directory read',
        );
        if (listed) {
          setStatus({ phase: 'failed', message: `${label}.dot is already in the directory` });
          return;
        }

        // Lazily, and only on the path that needs it: see trap 3.
        setStatus({ phase: 'working', step: 'mapping your account' });
        const mapped = await withTimeout(
          ensureContractAccountMapped(runtime, account.address, account.signer as never),
          TIMEOUT_MS,
          'account mapping',
        );
        if (mapped && 'ok' in mapped && !mapped.ok) {
          throw new Error(`account mapping failed: ${String(mapped.error)}`);
        }

        setStatus({ phase: 'working', step: 'waiting for your signature' });
        await withTimeout(contract.announce.tx(label), 90_000, 'announce');

        setStatus({ phase: 'done', label });
      } catch (err) {
        setStatus({
          phase: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [app, account],
  );

  const reset = useCallback(() => {
    if (account) setStatus({ phase: 'ready', address: account.address });
  }, [account]);

  return { status, announce, reset };
}
