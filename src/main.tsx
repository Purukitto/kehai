import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startFit } from './core/fit';
import { SettingsProvider } from './core/settings';
import { isTauri } from './core/tauriSource';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>
);

// A desktop window much bigger than the display it is laid out for shows that
// display's panel, larger. A remote panel's browser is left to its own zoom.
if (isTauri()) startFit().catch(() => undefined);
