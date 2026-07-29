import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/theme';
import { getLang } from './lib/i18n';
// The @font-face first, so the stack's Inter fallback is registered before any
// rule that names it. On Apple platforms nothing here is used: -apple-system
// wins and the type is SF Pro itself.
import './fonts.css';
import './styles.css';

// index.html already stamped the stored appearance before first paint; this
// re-asserts it from the module that owns the choice, so the two can never
// disagree after a hot reload.
initTheme();
document.documentElement.lang = getLang();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
