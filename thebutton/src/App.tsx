import { useCallback, useEffect, useState } from 'react';
import { useProductSDK } from '@parity/product-sdk/react';
import type { SignerAccount, SignerManager } from '@parity/product-sdk-signer';
import type { HexString } from 'polkadot-api';
import { ButtonScreen } from './ButtonScreen';
import { getSignerManager, useSignerState } from './lib/signer';
import { createMockDriver } from './lib/mockDriver';
import { createChainDriver } from './lib/chainDriver';
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

/** Runs inside the host container, against the deployed contract. */
export function HostApp() {
  const manager = getSignerManager();
  const signer = useSignerState();

  useEffect(() => {
    if (signer.status === 'disconnected') {
      void manager.connect();
    }
  }, [manager, signer.status]);

  const account = signer.selectedAccount;
  const error = signer.error;

  if (!account) {
    return (
      <ButtonScreen
        state={{
          ...INITIAL,
          phase: error ? 'error' : 'loading',
          error: error ? message(error) : null,
          step: error ? null : `connecting wallet (${signer.status})`,
        }}
        onPress={() => {}}
      />
    );
  }

  return <Connected account={account} manager={manager} />;
}

function Connected({ account, manager }: { account: SignerAccount; manager: SignerManager }) {
  const { address, name } = account;
  const [simulating, setSimulating] = useState(false);

  if (simulating) return <SimulatedScreen username={name} />;
  return (
    <ChainScreen
      account={account}
      manager={manager}
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
  manager,
  onSimulate,
}: {
  account: SignerAccount;
  manager: SignerManager;
  onSimulate: () => void;
}) {
  const { address, h160Address, name } = account;

  // Chain access goes through the SDK app instance so connections reuse the
  // container's, rather than opening a direct one the host warns about.
  const app = useProductSDK();
  const chain = app.chain;

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
        signerManager: manager,
        onStep,
      });
    },
    [chain, address, h160Address, name, manager],
  );

  const { state, press } = useButtonState(makeDriver);

  return <ButtonScreen state={state} onPress={press} onSimulate={onSimulate} />;
}
