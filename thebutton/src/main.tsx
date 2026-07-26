import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp } from '@parity/product-sdk';
import { ProductSDKContext } from '@parity/product-sdk/react';
import { isInsideContainer } from '@parity/product-sdk/host';
import { HostApp, MockApp } from './App';
import { ButtonScreen } from './ButtonScreen';
import type { ButtonState } from './lib/types';
import { APP_NAME } from './lib/config';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

const root = createRoot(container);

const BASE: ButtonState = {
  phase: 'loading',
  total: 0,
  yourOrdinal: null,
  username: null,
  tier: 0,
  roll: [],
  error: null,
  mocked: false,
  step: 'starting',
};

function screen(state: Partial<ButtonState>): ReactNode {
  return <ButtonScreen state={{ ...BASE, ...state }} onPress={() => {}} />;
}

/**
 * Shown when the SDK itself fails to start. The simulation needs nothing from
 * the SDK, so an init failure should not be the end of the visit.
 */
function FatalScreen({ reason }: { reason: string }) {
  const [simulating, setSimulating] = useState(false);
  if (simulating) return <MockApp />;
  return (
    <ButtonScreen
      state={{ ...BASE, phase: 'error', step: null, error: reason }}
      onPress={() => {}}
      onSimulate={() => setSimulating(true)}
    />
  );
}

root.render(<StrictMode>{screen({})}</StrictMode>);

// The SDK only works inside the Polkadot host container, so decide which app to
// mount before touching any SDK API.
void isInsideContainer()
  .catch(() => false)
  .then(async (inside) => {
    if (!inside) {
      root.render(
        <StrictMode>
          <MockApp />
        </StrictMode>,
      );
      return;
    }

    try {
      root.render(<StrictMode>{screen({ step: 'initialising sdk' })}</StrictMode>);

      // cloudStorage defaults to the *paseo* environment and connects the paseo
      // Bulletin chain during init. On a devnet host that chain is unsupported
      // and init throws ChainNotSupportedError, taking the whole app down. The
      // Button stores nothing off-chain, so turn it off.
      const app = await createApp({ name: APP_NAME, cloudStorage: false });

      root.render(
        <StrictMode>
          {/* The app instance owns chain connections; SignerManager owns keys. */}
          <ProductSDKContext.Provider value={app}>
            <HostApp />
          </ProductSDKContext.Provider>
        </StrictMode>,
      );
    } catch (error) {
      // An uncaught failure here used to leave a black screen with the reason
      // only visible in the console.
      root.render(
        <StrictMode>
          <FatalScreen reason={error instanceof Error ? error.message : String(error)} />
        </StrictMode>,
      );
    }
  });
