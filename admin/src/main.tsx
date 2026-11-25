import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { initAppearance } from './lib/appearance';
import { App } from './App';

initAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
