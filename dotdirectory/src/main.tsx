import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Before the sheet that uses it, so the face is registered when the first
// heading paints rather than after a flash of the fallback.
import './font/unbounded.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
