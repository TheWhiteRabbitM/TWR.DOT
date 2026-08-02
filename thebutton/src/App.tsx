import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProductSDK } from '@parity/product-sdk/react';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import type { HexString } from 'polkadot-api';
import { ButtonScreen } from './ButtonScreen';
import { useAccount } from './lib/signer';
import type { BalanceReader, ButtonAccount } from './lib/signer';
import { createMockDriver } from './lib/mockDriver';
import { createChainDriver } from './lib/chainDriver';
import type { ChainAccess } from './lib/chainDriver';
import { BUTTON_ADDRESS, MIN_TIER } from './lib/config';
import type { ButtonDriver, ButtonState } from './lib/types';

const INITIAL: ButtonState = {
  phase: 'loading',
  total: 0,
  yourOrdinal: null,
  username: null,
  tier: 0,
  roll: [],
  error: null,
  mocked: false,
  step: null,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reports progress so a stalled step is visible instead of a silent spinner. */
type StepReporter = (step: string) => void;

/**
 * Drives one {@link ButtonDriver} through the load / press lifecycle.
 *
 * `makeDriver` must be referentially stable — wrap it in useCallback.
 */
function useButtonState(makeDriver: (onStep: StepReporter) => Promise<ButtonDriver>) {
  const [state, setState] = useState<ButtonState>(INITIAL);
  const [driver, setDriver] = useState<ButtonDriver | null>(null);

  useEffect(() => {
    let cancelled = false;
    const onStep: StepReporter = (step) => {
      if (!cancelled) setState((prev) => ({ ...prev, step }));
    };

    void (async () => {
      try {
        const next = await makeDriver(onStep);
        if (cancelled) return;
        setDriver(next);

        const snapshot = await next.load();
        if (cancelled) return;

        setState({
          ...snapshot,
          error: null,
          step: null,
          phase:
            snapshot.yourOrdinal !== null
              ? 'pressed'
              : snapshot.tier >= MIN_TIER
                ? 'ready'
                : 'not-human',
        });
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, phase: 'error', error: message(error), step: null }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [makeDriver]);

  const press = useCallback(() => {
    if (!driver) return;

    setState((prev) => (prev.phase === 'ready' ? { ...prev, phase: 'pressing' } : prev));

    void (async () => {
      try {
        const ordinal = await driver.press();
        const snapshot = await driver.load();
        setState({
          ...snapshot,
          yourOrdinal: ordinal,
          phase: 'pressed',
          error: null,
          step: null,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          phase: 'ready',
          error: message(error),
          step: null,
        }));
      }
    })();
  }, [driver]);

  return { state, press };
}

/** Runs outside the Polkadot host: local mock only, no chain access. */
export function MockApp() {
  const makeDriver = useCallback(async () => createMockDriver(null), []);
  const { state, press } = useButtonState(makeDriver);

  return <ButtonScreen state={{ ...state, mocked: true }} onPress={press} />;
}

/**
 * Free balances, read through the host's shared chain connection.
 *
 * Only used to rank the user's accounts so the best-funded one signs. It lives
 * here rather than in lib/signer.ts because chain access belongs to the SDK app
 * instance — opening a second connection is what makes the host warn the user
 * about "Direct Chain Access".
 */
function makeBalanceReader(chain: ChainAccess): BalanceReader {
  return async (addresses) => {
    await chain.connect({ assetHub: devnet_asset_hub });
    const api = chain.getRawClient(devnet_asset_hub).getTypedApi(devnet_asset_hub);
    return Promise.all(
      addresses.map(async (address) => {
        try {
          const info = await api.query.System.Account.getValue(address);
          return BigInt(info?.data?.free ?? 0n);
        } catch {
          // A single unreadable account just loses its vote in the ranking.
          return null;
        }
      }),
    );
  };
}

/** Runs inside the host container, against the deployed contract. */
export function HostApp() {
  // Chain access goes through the SDK app instance so connections reuse the
  // container's, rather than opening a direct one the host warns about.
  const app = useProductSDK();
  const chain = app.chain as ChainAccess;

  // Referentially stable: useAccount re-runs its effect when this changes.
  const readBalances = useMemo(() => makeBalanceReader(chain), [chain]);
  const { status, account, error } = useAccount(readBalances);

  if (!account) {
    return (
      <ButtonScreen
        state={{
          ...INITIAL,
          phase: error ? 'error' : 'loading',
          error,
          step: error ? null : `connecting wallet (${status})`,
        }}
        onPress={() => {}}
      />
    );
  }

  return <Connected account={account} chain={chain} />;
}

function Connected({ account, chain }: { account: ButtonAccount; chain: ChainAccess }) {
  const { address, name } = account;
  const [simulating, setSimulating] = useState(false);

  if (simulating) return <SimulatedScreen username={name} />;
  return (
    <ChainScreen
      account={account}
      chain={chain}
      onSimulate={() => setSimulating(true)}
      key={`${address}-chain`}
    />
  );
}

/** The local simulation, reachable from inside the host when the chain says no. */
function SimulatedScreen({ username }: { username: string | null }) {
  const makeDriver = useCallback(async () => createMockDriver(username), [username]);
  const { state, press } = useButtonState(makeDriver);
  return <ButtonScreen state={{ ...state, mocked: true }} onPress={press} />;
}

function ChainScreen({
  account,
  chain,
  onSimulate,
}: {
  account: ButtonAccount;
  chain: ChainAccess;
  onSimulate: () => void;
}) {
  const { address, h160Address, name, kind, signer } = account;

  const makeDriver = useCallback(
    async (onStep: StepReporter) => {
      if (!BUTTON_ADDRESS) {
        // Inside the host but no deployment configured — still useful for UI work.
        return createMockDriver(name);
      }
      return createChainDriver({
        chain,
        address: BUTTON_ADDRESS as HexString,
        account: address,
        h160Address,
        username: name,
        signer,
        accountKind: kind,
        onStep,
      });
    },
    [chain, address, h160Address, name, kind, signer],
  );

  const { state, press } = useButtonState(makeDriver);

  return <ButtonScreen state={state} onPress={press} onSimulate={onSimulate} />;
}
