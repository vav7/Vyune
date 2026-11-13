import { createEffect, onCleanup } from 'solid-js';
import type { ArtworkColor } from './artworkColor';
import { artworkForPaint } from './artwork';
import { proxiedImg } from './api';
import { pageArtStore } from './pageArt';

/** A value, or a function that returns one. */
type Maybe<T> = T | (() => T);

/**
 * Tints the whole scrolling page with the artwork's colour while a detail
 * page is open, as Apple's album and playlist pages do (report §3,
 * `has-theme-override`). The text colours that sit on it are switched in
 * tokens.css by `data-tint`.
 *
 * Both arguments are accessors: the colour is measured after the artwork
 * arrives, and the artwork may change while the page is open. Reading them
 * as plain values would freeze the tint at whatever the page opened with.
 */
export function usePageTint(
  color: Maybe<ArtworkColor | null>,
  artworkUrl?: Maybe<string | null | undefined>,
) {
  const readColor = () => (typeof color === 'function' ? color() : color);
  const readUrl = () => (typeof artworkUrl === 'function' ? artworkUrl() : artworkUrl);

  // Apply the sampled theme before the browser paints the page. The color is
  // read synchronously from the per-browser artwork cache on repeat visits.
  createEffect(() => {
    const page = document.getElementById('scrollable-page');
    const sampled = readColor();
    const url = readUrl();
    if (!page || (!sampled && !url)) return;

    if (sampled) {
      page.style.setProperty('--page-tint', sampled.background);
      page.dataset.tint = sampled.dark ? 'dark' : 'light';
      if ((sampled.lum ?? 0) > 0.6) page.dataset.pale = 'true';
      else delete page.dataset.pale;
    }
    if (url) {
      page.style.setProperty('--page-artwork-image', `url("${proxiedImg(artworkForPaint(url, 1400))}")`);
      page.dataset.artwork = 'true';
      pageArtStore.set({ url, lum: sampled?.lum ?? 0, palette: sampled?.palette });
    }

    onCleanup(() => {
      page.style.removeProperty('--page-tint');
      delete page.dataset.tint;
      delete page.dataset.pale;
      page.style.removeProperty('--page-artwork-image');
      delete page.dataset.artwork;
      if (url) pageArtStore.set({ url: null });
    });
  });
}
