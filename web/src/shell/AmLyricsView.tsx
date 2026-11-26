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

import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js';
import { AmLyrics } from '@/vendor/am-lyrics/AmLyrics';
import { GoogleService } from '@/vendor/am-lyrics/GoogleService';
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
  .lyrics-header, .source-info, .version-info, .download-button, .source-switch-btn {
    display: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }
  .lyrics-footer { opacity: 0 !important; pointer-events: none !important; }
  /* Where the active line parks: am-lyrics' default is 18% from the top, which reads as
     "stuck at the top". About a third down keeps it in the middle of the eye line. */
  .lyrics-container { --lyrics-scroll-padding-top: 34%; }
  /* Restore original am-lyrics background-vocal (adlib) timing so adlibs enter and paint smoothly without a 300ms lag. */
  .lyrics-container {
    --am-lyrics-background-vocal-enter-delay: 0ms;
    --am-lyrics-background-vocal-enter-duration: 650ms;
    --am-lyrics-background-vocal-exit-duration: 450ms;
  }

  /* ---- Premium type: SF Pro / Inter Variable font for lyrics, crisp HD glyphs ---- */
  :host, .lyrics-container, .lyrics-line, .lyrics-syllable, .lyrics-word, span.char, span.word {
    font-family: 'MC SF Pro Display', 'SF Pro Rounded', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter Variable', 'Inter', system-ui, sans-serif !important;
    font-weight: 700 !important;
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
    font-synthesis: none !important;
  }
  :host {
    --am-lyrics-highlight-color: #ffffff;
    --lyplus-text-primary: #ffffff;
    /* The unsung words are pure translucent white: not muddy grey */
    --lyplus-text-secondary: rgba(255, 255, 255, 0.42);
    --am-lyrics-highlight-surface: transparent !important;
  }
  .lyrics-line.active,
  .lyrics-line.active .lyrics-word,
  .lyrics-line.active span.word,
  .lyrics-line.active span.char {
    color: #ffffff !important;
    text-shadow: none !important;
  }
  /* Remove cheap rectangular highlight background box behind active lines */
  .lyrics-line::before,
  .lyrics-line.active::before {
    display: none !important;
    content: none !important;
    background: transparent !important;
    opacity: 0 !important;
  }
  /* Three instrumental gap dots: calm, stationary, strictly horizontal */
  .lyrics-gap,
  .lyrics-line.lyrics-gap,
  .lyrics-gap-container {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    flex-wrap: nowrap !important;
    white-space: nowrap !important;
    width: auto !important;
    min-width: 0 !important;
  }
  .lyrics-gap .main-vocal-container {
    transform: none !important;
    animation: none !important;
    transition: opacity 0.3s ease !important;
  }
  .lyrics-gap .lyrics-word,
  .lyrics-line.lyrics-gap .lyrics-word,
  .lyrics-gap-container .lyrics-word {
    display: inline-flex !important;
    flex-direction: row !important;
    align-items: center !important;
    flex-wrap: nowrap !important;
    white-space: nowrap !important;
  }
  .lyrics-gap .lyrics-syllable,
  .lyrics-line.lyrics-gap .lyrics-syllable,
  .lyrics-gap-container .lyrics-syllable {
    width: 14px !important;
    height: 14px !important;
    min-width: 14px !important;
    min-height: 14px !important;
    max-width: 14px !important;
    max-height: 14px !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 50% !important;
    padding: 0 !important;
    padding-block: 0 !important;
    margin-block: 0 !important;
    margin-inline: 4px !important;
    -webkit-mask-image: none !important;
    mask-image: none !important;
    flex-shrink: 0 !important;
    display: inline-block !important;
    box-sizing: border-box !important;
    transform: none !important;
    animation: none !important;
  }
  :host, :host *, .lyrics-container, .lyrics-line, .lyrics-line-container, .main-vocal-container {
    box-sizing: border-box !important;
  }
  .lyrics-container {
    width: 100% !important;
    max-width: 100% !important;
    padding-inline-start: 12px !important;
    padding-inline-end: 48px !important;
    box-sizing: border-box !important;
    overflow-x: visible !important;
  }
  .lyrics-line {
    box-sizing: border-box !important;
    width: 100% !important;
    max-width: 100% !important;
    text-rendering: optimizeLegibility;
    font-kerning: normal;
    letter-spacing: -0.015em;
    line-height: 1.24 !important;
    margin-block-end: 22px !important;
    --am-lyrics-highlight-radius: 20px;
    will-change: transform, opacity;
    text-wrap: pretty !important;
    contain: none !important;
    overflow: visible !important;
    word-break: normal !important;
    overflow-wrap: break-word !important;
  }
  .lyrics-line:not(.singer-right) {
    padding-inline-start: 0 !important;
    padding-inline-end: 28px !important;
  }
  /* ---- Honest Line-Synced Lyrics (No Fake Horizontal Progressive Wipe) ---- */
  .lyrics-syllable.line-synced,
  .lyrics-line .lyrics-syllable.line-synced,
  .lyrics-line.active .lyrics-syllable.line-synced,
  .lyrics-line.pre-active .lyrics-syllable.line-synced {
    -webkit-mask-image: none !important;
    mask-image: none !important;
    background-image: none !important;
    background: transparent !important;
    animation: none !important;
    transform: none !important;
    -webkit-text-fill-color: initial !important;
  }
  .lyrics-line.active .lyrics-syllable.line-synced {
    color: #ffffff !important;
    opacity: 1 !important;
    transition: color 0.22s ease-out, opacity 0.22s ease-out !important;
  }
  .lyrics-line:not(.active) .lyrics-syllable.line-synced {
    color: rgba(255, 255, 255, 0.42) !important;
    opacity: 0.42 !important;
    transition: color 0.35s ease-out, opacity 0.35s ease-out !important;
  }
  /* Duet songs: align the other singer's voice clearly to the right side */
  .lyrics-line.singer-right,
  .lyrics-container .lyrics-line.singer-right,
  .lyrics-container.has-duet-lines .lyrics-line.singer-right {
    text-align: right !important;
    text-align: end !important;
    padding-inline-start: 22% !important;
    padding-inline-end: 8px !important;
  }
  .lyrics-line.singer-right .lyrics-line-container,
  .lyrics-line.singer-right .main-vocal-container {
    text-align: right !important;
    text-align: end !important;
    transform-origin: right center !important;
  }
  .lyrics-line.singer-right .background-vocal-container,
  .lyrics-line.singer-right .background-vocal-wrap {
    text-align: right !important;
    text-align: end !important;
    margin-left: auto !important;
    margin-right: 0 !important;
    transform-origin: right center !important;
  }
  .lyrics-container.has-duet-lines .lyrics-line.singer-left {
    padding-inline-end: 22% !important;
    padding-inline-start: 0 !important;
    text-align: left !important;
    text-align: start !important;
  }
  .lyrics-line-container,
  .main-vocal-container {
    box-sizing: border-box !important;
    width: 100% !important;
    max-width: 100% !important;
    overflow: visible !important;
    overflow-wrap: break-word !important;
    word-break: normal !important;
  }
  .lyrics-word {
    max-width: 100% !important;
    box-sizing: border-box !important;
    white-space: nowrap !important;
    word-break: normal !important;
    overflow-wrap: normal !important;
  }
  .lyrics-word.allow-break {
    white-space: normal !important;
    overflow-wrap: break-word !important;
    word-break: normal !important;
  }
  .lyrics-line::before { corner-shape: squircle; }
  /* Scope vertical glyph headroom to main vocals only so background adlibs aren't clipped or shifted. */
  .lyrics-line:not(.lyrics-gap) .main-vocal-container .lyrics-syllable,
  .lyrics-line:not(.lyrics-gap) .main-vocal-container .lyrics-syllable span.char {
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
  let currentTrackId: string | null = null;
  const clock = new LyricClock(0);

  const [enrichedLines, setEnrichedLines] = createSignal<LyricsLine[] | null>(null);
  const effectiveLines = () => enrichedLines() ?? props.lines;
  const ttml = createMemo(() => linesToTtml(effectiveLines()));

  // Enrich lines with accurate line-locked translation/romanization when toggled on (works in both Full & Panel modes)
  createEffect(() => {
    const base = props.lines;
    const wantTrans = props.translation;
    const wantRoman = props.romanization;
    let cancelled = false;

    if (!base.length || (!wantTrans && !wantRoman)) {
      setEnrichedLines(null);
      return;
    }

    const needsTrans = wantTrans && base.some((l) => !l.section && !l.translation && l.text?.some((s) => s.text?.trim()));
    const needsRoman = wantRoman && base.some((l) => !l.section && !l.romanizedText && l.text?.some((s) => s.text?.trim()));

    if (!needsTrans && !needsRoman) {
      setEnrichedLines(null);
      return;
    }

    void (async () => {
      let next = base;
      if (needsTrans) {
        const lineTexts = next.map((l) => (l.section ? '' : l.text.map((s) => s.text).join('').trim()));
        const translated = await GoogleService.translate(lineTexts, 'en').catch(() => null);
        if (cancelled) return;
        if (Array.isArray(translated)) {
          next = next.map((l, i) =>
            l.translation || !translated[i] ? l : { ...l, translation: translated[i] },
          );
        }
      }
      if (needsRoman) {
        const romanInput = next.map((l) => ({
          text: l.text.map((s) => ({ text: s.text, romanizedText: s.romanizedText })),
          romanizedText: l.romanizedText,
          isWordSynced: l.text.length > 1,
        }));
        const romanized = await GoogleService.romanize(romanInput).catch(() => null);
        if (cancelled) return;
        if (Array.isArray(romanized)) {
          next = next.map((l, i) =>
            l.romanizedText || !romanized[i]?.romanizedText ? l : { ...l, romanizedText: romanized[i].romanizedText },
          );
        }
      }
      if (!cancelled) setEnrichedLines(next);
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

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
    currentTrackId = playerStore.current?.id || null;
    el?.remove();
    const next = document.createElement('am-lyrics') as AmElement;
    next.noAutoAlternates = true; // nothing is generated or fetched behind our sheet
    next.highlightColor = '#ffffff';
    next.fontFamily = props.fontFamily;
    next.songDurationMs = Math.round((playerStore.current?.duration || 0) * 1000) || undefined;
    const shaping = props.lines.some((line) => line.text.some((syllable) => SHAPING.test(syllable.text)));
    if (shaping) next.setAttribute('data-shaping', '');
    const size = Math.round((props.full ? 38 : 20) * (shaping ? 1.15 : 1));
    next.style.cssText = `display:block;width:100%;height:100%;--lyplus-font-size-base:${size}px;--am-lyrics-line-height:${shaping ? 1.4 : 1.24};--am-lyrics-line-spacing:${shaping ? 26 : (props.full ? 24 : 18)}px;`;
    next.showRomanization = props.romanization;
    next.showTranslation = props.translation;
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

  // In-place TTML upgrade for the same track preserves scroll offset and avoids line-0 flash
  createEffect(
    on(ttml, (nextTtml) => {
      if (!el) return;
      const trackId = playerStore.current?.id || null;
      if (trackId && trackId === currentTrackId) {
        el.ttml = nextTtml;
        lastMs = Number.NaN;
        wake();
      } else {
        mount();
      }
    }, { defer: true })
  );

  // Full remount when the playing song changes
  createEffect(
    on(() => playerStore.current?.id, (newId) => {
      if (el && newId !== currentTrackId) {
        mount();
      }
    }, { defer: true })
  );
  createEffect(on([() => props.translation, () => props.romanization], apply, { defer: true }));
  // When user adjusts lyrics timing offset (+50ms / -50ms / reset), immediately force clock jump & redraw
  createEffect(on(() => lyricsStore.syncOffsetMs, () => {
    discontinuity++;
    lastMs = Number.NaN;
    wake();
  }, { defer: true }));

  return <div ref={host} class="am-lyrics-host h-full min-h-0 w-full flex-1" />;
}
