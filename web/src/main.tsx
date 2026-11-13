/* main.tsx — boot: wait for the stylesheet, render, retire the skeleton. */

import { render } from 'solid-js/web';
import { QueryClientProvider } from '@tanstack/solid-query';
import App from './App';
import { queryClient } from './lib/queryClient';
import { startQueryPersist } from './lib/queryPersist';
import { installGlint } from './lib/glint';

const root = document.getElementById('root');
if (!root) throw new Error('VYUNE: #root is missing from the document');

/** A deploy removes old chunk files; a tab opened before it then fails to load a lazy page. Reload once, quietly. */
function recoverFromStaleChunks() {
  const reload = () => {
    if (sessionStorage.getItem('vy-reloaded')) return;
    sessionStorage.setItem('vy-reloaded', '1');
    location.reload();
  };
  window.addEventListener('unhandledrejection', (e) => {
    if (/dynamically imported module|Importing a module script failed|Loading chunk/i.test(String(e.reason?.message || e.reason))) reload();
  });
  setTimeout(() => sessionStorage.removeItem('vy-reloaded'), 10_000);
}

startQueryPersist();
installGlint();
recoverFromStaleChunks();

if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  ),
  root,
);
