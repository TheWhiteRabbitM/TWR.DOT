import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp } from '@parity/product-sdk';
import { ProductSDKContext } from '@parity/product-sdk/react';
import { isInsideContainer } from '@parity/product-sdk/host';
import { HostApp, MockApp } from './App';
import { APP_NAME } from './lib/config';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

const root = createRoot(container);

function Note({ text }: { text: string }) {
  return (
    <div className="page">
      <main className="container">
        <div className="card pad">
          <p className="empty">{text}</p>
        </div>
      </main>
    </div>
  );
}

root.render(<StrictMode>{<Note text="Starting…" />}</StrictMode>);

// The SDK only works inside the Polkadot host container; decide which app to
// mount before touching any SDK API. cloudStorage stays off: it defaults to
// the paseo environment, whose Bulletin chain a devnet host does not support,
// and its init failure would take the whole app down (see thebutton/README.md).
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
      const app = await createApp({ name: APP_NAME, cloudStorage: false });
      root.render(
        <StrictMode>
          <ProductSDKContext.Provider value={app}>
            <HostApp />
          </ProductSDKContext.Provider>
        </StrictMode>,
      );
    } catch (error) {
      root.render(
        <StrictMode>
          <Note
            text={`The Polkadot host could not be initialised: ${
              error instanceof Error ? error.message : String(error)
            }`}
          />
        </StrictMode>,
      );
    }
  });
