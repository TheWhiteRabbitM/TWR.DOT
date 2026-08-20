import { useCallback, useEffect, useState } from 'react';
import { isInsideContainer, getAccountsProvider } from '@parity/product-sdk/host';
import {
  createContract,
  createContractRuntimeFromClient,
  ensureContractAccountMapped,
} from '@parity/product-sdk/contracts';
import { ss58Encode, deriveH160, addressesEqual } from '@parity/product-sdk/address';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { App } from '@parity/product-sdk/core';
import { DIRECTORY, CONTENT_RESOLVER, nodeOf, readName } from './chain';
import type { NameState } from './chain';
import { DIRECTORY_ABI, RESOLVER_ABI } from './abi';

/**
 * Registering a site from the page.
 *
 * Two different things happen here and they have different rules, which is the
 * only real complexity in this file:
 *
 *   announce()  puts the NAME in the directory. Anyone may call it for anyone,
 *               because the contract admits a label only if DotNS already gives
 *               it an owner — so announcing someone else's name is a favour.
 *   setText()   puts the DESCRIPTION on the name. Only the owner may call it.
 *               The resolver is where `manifest` and `category` live, and those
 *               records are what turn a list of names into a directory.
 *
 * So the form can always offer the first and can only sometimes offer the
 * second, and it should say which before asking for a signature rather than
 * spending one to collect a refusal.
 *
 * WHAT ONLY WORKS INSIDE THE HOST
 * Signing needs the user's keys, which live in the Polkadot App. Outside it the
 * page still reads completely — it simply cannot write.
 *
 * FIVE TRAPS. The first three were documented in thebutton/src/lib/signer.ts and
 * the last two in dotmail/src/names.ts; all five were paid for there, and are
 * avoided here by reading those files rather than rediscovering them.
 *   1. SignerManager never reaches the user's keys inside the host — it returns
 *      an app-scoped account the host derives, which starts empty and is not in
 *      the wallet UI. The accounts provider is asked directly instead.
 *   2. Read-only dry runs must not use an unmapped origin: pallet-revive rejects
 *      it with AccountUnmapped, and a fresh account is always unmapped. Reads
 *      here dodge that entirely by going over ethers on a public RPC.
 *   3. Account mapping submits its own transaction, so it runs lazily on the
 *      first write rather than at load — making a read-only page wait on a
 *      signature is how thebutton's UI ended up stuck on "reading register".
 *   4. GAS MUST BE EXPLICIT. The SDK's sizing dry run comes back short and the
 *      call reverts BEFORE the wallet sheet is raised, so the user sees a
 *      refusal without ever being asked to sign — the worst possible failure,
 *      because it looks like the app is broken rather than the estimate.
 *   5. A write that returns ok and changes nothing has happened here before, so
 *      every write is read back off the chain before it is called done.
 *
 * Two API shapes differ from thebutton's vintage: getLegacyAccounts returns a
 * neverthrow ResultAsync rather than a promise, and a HostAccount carries a raw
 * public key rather than an address. And an H160 is derived from that key by a
 * HASH, not by truncating it — hence deriveH160 rather than a slice.
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

/** What the owner wants the name to say. Empty strings mean "leave it alone". */
export interface Desired {
  displayName: string;
  description: string;
  category: string;
}

export type RegisterStatus =
  | { phase: 'unavailable'; why: string }
  | { phase: 'ready'; address: string }
  | { phase: 'working'; step: string }
  | { phase: 'done'; label: string; did: string[] }
  | { phase: 'failed'; message: string };

export interface Registrar {
  status: RegisterStatus;
  /** The connected account's H160, for comparing against a name's owner. */
  h160: string | null;
  /** True when this account owns the name — i.e. may describe it. */
  owns: (state: NameState) => boolean;
  submit: (state: NameState, desired: Desired) => Promise<void>;
  reset: () => void;
}

export function useRegistrar(app: App | null): Registrar {
  const [status, setStatus] = useState<RegisterStatus>({
    phase: 'unavailable',
    why: 'checking for a wallet…',
  });
  const [account, setAccount] = useState<{
    address: string;
    h160: string;
    signer: unknown;
  } | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const inside = await Promise.resolve(isInsideContainer()).catch(() => false);
      if (!alive) return;
      if (!inside) {
        setStatus({
          phase: 'unavailable',
          why: 'open this in the Polkadot app to register a site — reading works anywhere',
        });
        return;
      }
      if (!app) {
        setStatus({ phase: 'unavailable', why: 'sdk not ready' });
        return;
      }

      try {
        // Straight to the accounts provider: see trap 1.
        const provider = await withTimeout(getAccountsProvider(), TIMEOUT_MS, 'accounts provider');
        if (!provider) {
          setStatus({ phase: 'unavailable', why: 'the host exposed no accounts provider' });
          return;
        }

        // A neverthrow ResultAsync: awaiting it yields a Result, and the failure
        // case has to be matched rather than caught.
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
        const h160 = deriveH160(first.publicKey);
        const signer = provider.getLegacyAccountSigner({ publicKey: first.publicKey });
        setAccount({ address, h160, signer });
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

  const owns = useCallback(
    (state: NameState) =>
      Boolean(account && state.owner && addressesEqual(account.h160, state.owner)),
    [account],
  );

  const submit = useCallback(
    async (state: NameState, desired: Desired) => {
      if (!app || !account) {
        setStatus({ phase: 'failed', message: 'no wallet account to sign with' });
        return;
      }
      const { label } = state;
      if (!state.registered) {
        setStatus({ phase: 'failed', message: `${label}.dot is not registered in DotNS` });
        return;
      }

      // Decide the whole plan before signing anything, so the user is asked for
      // exactly as many signatures as there is work — and none when there is
      // nothing to do.
      const mine = owns(state);
      const wantsManifest =
        mine &&
        Boolean(desired.displayName.trim() || desired.description.trim()) &&
        (desired.displayName.trim() !== (state.records.displayName ?? '') ||
          desired.description.trim() !== (state.records.description ?? ''));
      const wantsCategory =
        mine &&
        Boolean(desired.category.trim()) &&
        desired.category.trim().toLowerCase() !== (state.records.category ?? '');

      if (state.listed && !wantsManifest && !wantsCategory) {
        setStatus({
          phase: 'failed',
          message: mine
            ? `${label}.dot is already listed and already says this`
            : `${label}.dot is already listed — only its owner can change what it says`,
        });
        return;
      }

      const did: string[] = [];

      try {
        setStatus({ phase: 'working', step: 'preparing' });
        const client = app.chain.getRawClient(devnet_asset_hub);
        const runtime = createContractRuntimeFromClient(client, devnet_asset_hub);
        // `defaultSigner` is the option createContract actually reads; a plain
        // `{ signer }` leaves every .tx() with no signer at all.
        const opts = { defaultSigner: account.signer as never };

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

        if (!state.listed) {
          const directory = createContract(runtime, DIRECTORY, DIRECTORY_ABI, opts);
          setStatus({ phase: 'working', step: `signing — add ${label}.dot to the directory` });
          await withTimeout(directory.announce.tx(label, WEIGHTS), SIGN_MS, 'announce');
          did.push('listed');
        }

        if (wantsManifest || wantsCategory) {
          const resolver = createContract(runtime, CONTENT_RESOLVER, RESOLVER_ABI, opts);
          const node = nodeOf(label);

          if (wantsManifest) {
            // Same shape the page already parses, and the same shape every other
            // described name on the chain uses. `$v` is the version other readers
            // key off, so a hand-written manifest stays forward-compatible.
            const manifest = JSON.stringify({
              $v: 1,
              displayName: desired.displayName.trim() || label,
              description: desired.description.trim(),
            });
            setStatus({ phase: 'working', step: 'signing — write the description' });
            await withTimeout(
              resolver.setText.tx(node, 'manifest', manifest, WEIGHTS),
              SIGN_MS,
              'manifest write',
            );
            did.push('described');
          }

          if (wantsCategory) {
            setStatus({ phase: 'working', step: 'signing — write the category' });
            await withTimeout(
              resolver.setText.tx(node, 'category', desired.category.trim().toLowerCase(), WEIGHTS),
              SIGN_MS,
              'category write',
            );
            did.push('categorised');
          }
        }

        // Trap 5: ask the chain rather than the receipt.
        setStatus({ phase: 'working', step: 'confirming on-chain' });
        const after = await withTimeout(readName(label), TIMEOUT_MS, 'read-back');
        if (!after.listed) {
          throw new Error('the write was accepted but the name is still not listed');
        }
        if (wantsManifest && !after.records.described) {
          throw new Error('the write was accepted and the description is still empty');
        }

        setStatus({ phase: 'done', label, did });
      } catch (err) {
        setStatus({
          phase: 'failed',
          // A partial success is not a failure to hide: say what did land.
          message:
            (err instanceof Error ? err.message : String(err)) +
            (did.length ? ` (already done: ${did.join(', ')})` : ''),
        });
      }
    },
    [app, account, owns],
  );

  const reset = useCallback(() => {
    if (account) setStatus({ phase: 'ready', address: account.address });
  }, [account]);

  return { status, h160: account?.h160 ?? null, owns, submit, reset };
}
