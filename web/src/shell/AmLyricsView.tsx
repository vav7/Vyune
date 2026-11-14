/* AmLyricsView.tsx — the lyrics renderer: the real <am-lyrics> web component
 * (github.com/binimum/am-lyrics, vendored in src/vendor/am-lyrics, MPL-2.0),
 * exactly as released. It draws the word wipe, the glitchy blink and the three
 * instrumental dots, paints line-synced sheets too, scrolls the active line up
 * and blurs what is far from it. This file only
 *
 *   1. hands it our sheet as TTML (lib/amttml.ts), so it fetches nothing,
 *   2. feeds it the playhead every frame (the steered LyricClock),
 *   3. turns a tapped line into a seek, and
 *   4. restyles its header/footer chrome away — the panel has its own menu.
 */

import { createEffect, createMemo, on, onCleanup, onMount } from 'solid-js';
import { AmLyrics } from '@/vendor/am-lyrics/AmLyrics';
import { LyricClock } from '@/lib/clock';
import { linesToTtml } from '@/lib/amttml';
import type { LyricsLine } from '@/lib/types';
import { audio, playerStore } from '@/store/player';
import { lyricsStore } from '@/store/lyrics';

if (!customElements.get('am-lyrics')) customElements.define('am-lyrics', AmLyrics);

// am-lyrics' own header (romanise/translate/download) and source footer: the
// panel's menu already does all of that, so they are not drawn. The footer must
// stay IN the layout, only invisible: am-lyrics measures the scrollable height
// from it, and with it collapsed (display:none) the scroll range is zero and
// the active line never rises.
const CHROME = `
  .lyrics-header { display: none !important; }
  .lyrics-footer { opacity: 0 !important; pointer-events: none !important; }
  /* Where the active line parks: am-lyrics' default is 18% from the top, which reads as
     "stuck at the top". About a third down keeps it in the middle of the eye line. */
  .lyrics-container { --lyrics-scroll-padding-top: 34%; }
  /* Ad-libs never overlap their neighbours. am-lyrics commits an ad-lib's height at once and
     lets the lines below glide into place; the ad-lib's text must not be visible during that
     glide. So it fades IN after the neighbours have moved clear (the enter delay is the one
     local patch in the vendored file) and fades OUT quickly, before the neighbour arrives. */
  .lyrics-container {
    --am-lyrics-background-vocal-enter-delay: 300ms;
    --am-lyrics-background-vocal-enter-duration: 560ms;
    --am-lyrics-background-vocal-exit-duration: 140ms;
  }

  /* ---- Premium type: pure white paint, crisp HD glyphs, nothing cropped ---- */
  :host {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", system-ui, sans-serif !important;
    --am-lyrics-highlight-color: #ffffff;
    --lyplus-text-primary: #ffffff;
    /* The unsung words are white too, only quieter: not a muddy grey. */
    --lyplus-text-secondary: rgb(255 255 255 / 0.5);
    --am-lyrics-highlight-surface: rgb(255 255 255 / 0.1);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-synthesis: none;
  }
  .lyrics-gap .lyrics-syllable,
  .lyrics-line.lyrics-gap .lyrics-syllable,
  .lyrics-gap-container .lyrics-syllable {
    width: 8px !important;
    height: 8px !important;
    min-width: 8px !important;
    min-height: 8px !important;
    max-width: 8px !important;
    max-height: 8px !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 50% !important;
    corner-shape: round !important;
    padding: 0 !important;
    padding-block: 0 !important;
    margin-block: 0 !important;
    margin-inline: 4px !important;
    -webkit-mask-image: none !important;
    mask-image: none !important;
    flex-shrink: 0 !important;
    display: inline-block !important;
    box-sizing: border-box !important;
  }
  /* Hardware-accelerated kinetic lyrics: strip costly multi-pass Gaussian blur filters */
  .lyrics-line,
  .lyrics-line * {
    filter: none !important;
    -webkit-filter: none !important;
  }
  .lyrics-line {
    text-rendering: optimizeLegibility;
    font-kerning: normal;
    letter-spacing: -0.02em;
    line-height: 1.25 !important;
    margin-block-end: 22px !important;
    --am-lyrics-highlight-radius: 24px;
    will-change: transform, opacity;
  }
  .lyrics-line::before { corner-shape: squircle; }
  .lyrics-line.active, .lyrics-line.pre-active {
    color: #ffffff !important;
    opacity: 1 !important;
  }
  .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.42 !important;
    transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1) !important;
  }
  .lyrics-line.next-active-line,
  .lyrics-line.post-active-line {
    opacity: 0.65 !important;
  }
  /* background-clip:text only paints inside the span's box. A tight box shaves the top off tall
     glyphs and Indic vowel signs, so every span gets vertical room, cancelled by the negative
     margin so the layout does not move. (Vertical only: the wipe is horizontal.) */
  .lyrics-line:not(.lyrics-gap) .lyrics-syllable,
  .lyrics-line:not(.lyrics-gap) .lyrics-syllable span.char {
    padding-block: 0.34em 0.26em;
    margin-block: -0.34em -0.26em;
  }
  /* Ligatures stay on: conjuncts and matra placement come from the font's own shaping. */
  :host([data-shaping]) .lyrics-syllable,
  :host([data-shaping]) .lyrics-syllable span.char {
    font-variant-ligatures: normal;
    font-feature-settings: normal;
    letter-spacing: 0;
    word-spacing: 0.06em;
  }
  :host([data-shaping]) .lyrics-line { letter-spacing: 0; }
  /* The romanised / translated sub-lines get the same care. */
  .lyrics-syllable.transliteration, .translation, .romanization { text-rendering: optimizeLegibility; }
`;

/** Scripts whose vowel signs and conjuncts need a taller line and unbroken shaping. */
const SHAPING = /[\u0900-\u0dff\u0e00-\u0fff\u1000-\u109f\u1780-\u17ff]/;

/** The members of the element this wrapper sets that its public typings keep private. */
type AmElement = HTMLElement & {
  ttml?: string;
  currentTime: number;
  noAutoAlternates: boolean;
  highlightColor: string;
  fontFamily?: string;
  songDurationMs?: number;
  showRomanization: boolean;
  showTranslation: boolean;
  updateComplete: Promise<boolean>;
};

export function AmLyricsView(props: {
  lines: LyricsLine[];
  full: boolean;
  fontFamily: string;
  translation: boolean;
  romanization: boolean;
}) {
  let host!: HTMLDivElement;
  let el: AmElement | null = null;
  let frame = 0;
  let still = 0;
  let lastMs = Number.NaN;
  let discontinuity = 0;
  const clock = new LyricClock(0);

  const ttml = createMemo(() => linesToTtml(props.lines));

  const apply = () => {
    if (!el) return;
    el.showRomanization = props.romanization;
    el.showTranslation = props.translation;
  };

  const tick = () => {
    frame = 0;
    if (!el) return;
    const now = performance.now();
    const effectiveLead = 140 + (lyricsStore.syncOffsetMs || 0);
    const audioMs = Math.max(0, Math.trunc(audio.currentTime * 1000) + effectiveLead);
    const ms = clock.frame(now, audioMs, now, discontinuity);
    if (ms !== lastMs) el.currentTime = ms;
    // Sleep when paused and nothing is changing; any transport event wakes it.
    still = audio.paused && ms === lastMs ? still + 1 : 0;
    lastMs = ms;
    if (still < 4) frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    still = 0;
    if (!frame) {
      clock.restart();
      frame = requestAnimationFrame(tick);
    }
  };
  const onJump = () => {
    discontinuity++;
    wake();
  };

  const mount = () => {
    el?.remove();
    const next = document.createElement('am-lyrics') as AmElement;
    (next as any).noBlur = true;
    next.noAutoAlternates = true; // nothing is generated or fetched behind our sheet
    next.highlightColor = '#ffffff';
    next.fontFamily = props.fontFamily;
    next.songDurationMs = Math.round((playerStore.current?.duration || 0) * 1000) || undefined;
    const shaping = props.lines.some((line) => line.text.some((syllable) => SHAPING.test(syllable.text)));
    if (shaping) next.setAttribute('data-shaping', '');
    // A little larger than before; Indic scripts also get a taller line so the upper matras clear.
    // Devanagari and its relatives have a small x-height beside Latin at the same size, so they run larger.
    const size = Math.round((props.full ? 46 : 30) * (shaping ? 1.22 : 1));
    next.style.cssText = `display:block;width:100%;height:100%;--lyplus-font-size-base:${size}px;--am-lyrics-line-height:${shaping ? 1.62 : 1.22};--am-lyrics-line-spacing:${shaping ? 36 : 30}px;`;
    next.ttml = ttml();
    next.addEventListener('line-click', (event) => {
      const at = (event as CustomEvent<{ timestamp: number }>).detail?.timestamp;
      if (typeof at !== 'number') return;
      playerStore.seek(at / 1000);
      if (audio.paused) void audio.play().catch(() => {});
      onJump();
    });
    host.appendChild(next);
    el = next;
    void next.updateComplete.then(() => {
      if (el !== next || !next.shadowRoot) return;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CHROME);
      next.shadowRoot.adoptedStyleSheets = [...next.shadowRoot.adoptedStyleSheets, sheet];
      apply();
    });
    lastMs = Number.NaN;
    wake();
  };

  onMount(() => {
    mount();
    const events = ['play', 'playing', 'pause', 'waiting', 'ratechange', 'timeupdate'] as const;
    for (const name of events) audio.addEventListener(name, wake);
    audio.addEventListener('seeking', onJump);
    audio.addEventListener('seeked', onJump);
    onCleanup(() => {
      for (const name of events) audio.removeEventListener(name, wake);
      audio.removeEventListener('seeking', onJump);
      audio.removeEventListener('seeked', onJump);
      if (frame) cancelAnimationFrame(frame);
      el?.remove();
      el = null;
    });
  });

  // A different sheet is a different element: nothing of the old song is left in it.
  createEffect(on(ttml, () => el && mount(), { defer: true }));
  createEffect(on([() => props.translation, () => props.romanization], apply, { defer: true }));

  return <div ref={host} class="am-lyrics-host h-full min-h-0 w-full flex-1" />;
}
