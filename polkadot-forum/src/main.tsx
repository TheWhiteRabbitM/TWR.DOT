import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

/* The forum reads without any SDK — browsing needs no wallet and downloads none
 * of the ~4 MB of chain descriptors. The write path in forum.ts imports the SDK
 * lazily, only when someone actually posts. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
