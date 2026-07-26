import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { requestHostPermissions } from './lib/host-permissions';
import './styles.css';

// Inside the Polkadot shell, ask for every sandbox permission up front.
void requestHostPermissions();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

