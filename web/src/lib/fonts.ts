/**
 * fonts.ts — fonts that are not needed to paint the app, fetched when something needs them.
 *
 * The Indic faces used to be two render-blocking third-party stylesheets in <head>: every page load, on every
 * network, waited for Google before showing a pixel. They are now injected the first time lyrics open, and the
 * stylesheet is non-blocking by construction (it is added after load, never in the document's critical path).
 */

const INDIC =
  'https://fonts.googleapis.com/css2?family=Hind:wght@400;500;600;700' +
  '&family=Noto+Sans+Devanagari:wght@500;600;700&family=Noto+Sans+Gurmukhi:wght@500;600;700' +
  '&family=Noto+Sans+Bengali:wght@500;600;700&family=Noto+Sans+Tamil:wght@500;600;700' +
  '&family=Noto+Sans+Telugu:wght@500;600;700&family=Noto+Sans+Gujarati:wght@500;600;700' +
  '&family=Noto+Sans+Kannada:wght@500;600;700&family=Noto+Sans+Malayalam:wght@500;600;700&display=swap';

let requested = false;

/** Idempotent. The browser still downloads only the script ranges a rendered line actually uses. */
export function ensureIndicFonts(): void {
  if (requested || typeof document === 'undefined') return;
  requested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = INDIC;
  document.head.appendChild(link);
}
