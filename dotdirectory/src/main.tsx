import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { App } from '@parity/product-sdk/core';
import Directory from './App';
// Before the sheet that uses them, so the faces are registered when the first
// heading paints rather than after a flash of the fallback.
import './font/fonts.css';
import './styles.css';

/**
 * The page reads without the SDK and writes with it.
 *
 * Outside the Polkadot app there is no host, no wallet and no createApp — and
 * the directory still works completely, because every read goes over a public
 * RPC. So the SDK is loaded dynamically and opportunistically, and its absence
 * is not the page's failure: `app` stays null, the announce panel never mounts,
 * and everything else is untouched.
 *
 * The import is dynamic rather than static for weight, not tidiness: the SDK
 * and its descriptors carry SCALE metadata for every supported chain, eight
 * chunks between 250 kB and 880 kB. A static import puts all of it in the main
 * bundle for every reader. Only the type is imported statically, which erases.
 */
function Root() {
  const [app, setApp] = useState<App | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { isInsideContainer } = await import('@parity/product-sdk/host');
        const inside = await Promise.resolve(isInsideContainer()).catch(() => false);
        if (!inside || !alive) return;

        const { createApp } = await import('@parity/product-sdk/core');
        // cloudStorage defaults to the paseo environment and connects the paseo
        // Bulletin chain during init; on a devnet host that chain is
        // unsupported and init throws, taking the app instance with it. This
        // page stores nothing off-chain, so it is off.
        const instance = await createApp({ name: 'dotdirectory', cloudStorage: false });
        if (alive) setApp(instance);
      } catch {
        /* no sdk, no host: the page reads perfectly well without either */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return <Directory app={app} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
