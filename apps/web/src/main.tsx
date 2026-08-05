import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * The boot screen in `index.html` is dismissed here, by the last statement of
 * the module graph it exists to cover for.
 *
 * Not by a CSS rule and not by a timer: if any module above this line throws,
 * this line is never reached, the fallback stays on the screen and says so.
 * That is the whole arrangement — the removal has to be the thing that proves
 * the application started.
 *
 * The initial `render` of a root commits synchronously, so `#root` already has
 * the first paint in it by the time this runs.
 */
document.getElementById('app-boot')?.remove();
