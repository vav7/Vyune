import { createEffect, createMemo, createSignal, on, Show, type JSX } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { api } from '@/lib/api';
import { sizedArtwork } from '@/lib/artwork';
import { getCachedArtwork, setCachedArtwork } from '@/lib/artworkCache';
import type { Track } from '@/lib/types';

interface ArtworkProps {
  src?: string | null;
  /** The CSS pixel width it renders at, so the CDN is asked for that size. */
  displayWidth: number;
  /** width / height. */
  aspect?: number;
  radius?: JSX.CSSProperties['border-radius'];
  class?: string;
  /** Eager for above-the-fold heroes; lazy everywhere else. */
  eager?: boolean;
  /** Track identity for a catalog-art fallback when its image is a video still. */
  track?: Track | null;
  /** Album or list art, after an exact track-art lookup. */
  fallbackSrc?: string | null;
  /** An explicit candidate chain, best first (the full-screen poster ladder). */
  candidates?: string[];
}

// A clean sleeve: a hairline stroke and a short, cheap shadow. No filters and no
// overlays per image, so a long discography scrolls on the compositor alone.
const frame = 'relative isolate w-full overflow-hidden bg-joe artwork-stroke shadow-[0_1px_4px_#00000066]';
const isVideoThumbnail = (url?: string | null) => !!url && /(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(url);

/**
 * Fixed-aspect artwork: a neutral placeholder until the image decodes, then a
 * short fade. The 0.5px inner stroke is Apple's "has-borders" treatment.
 * A failed load walks catalogue-art candidates once each. Video thumbnails
 * are excluded even when a caller passes one as the primary source.
 *
 * Every prop is read through `props`, never destructured: the candidate chain
 * is a memo, so a reused instance follows its props instead of freezing on
 * the first picture it was given.
 */
export function Artwork(props: ArtworkProps) {
  const [attempt, setAttempt] = createSignal(0);
  const [sawDeadThumb, setSawDeadThumb] = createSignal(false);
  const [broken, setBroken] = createSignal(false);

  // Check memory / localStorage cache synchronously
  const cachedArt = () => (props.track ? getCachedArtwork(props.track) : null);

  // Only look up high-res catalogue artwork for large sleeves/posters (>64px) if not already cached,
  // OR immediately if a 120x90 deleted-video placeholder was detected.
  const needsLookup = () =>
    (props.displayWidth > 64 || sawDeadThumb()) &&
    !!props.track &&
    !cachedArt() &&
    (isVideoThumbnail(props.track.thumb) || !props.track.thumb || sawDeadThumb());

  const catalogArtwork = useQuery(() => ({
    queryKey: ['catalog-artwork', props.track?.id],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      props.track ? api.artwork(props.track, signal) : Promise.resolve({ thumb: null }),
    enabled: needsLookup(),
    staleTime: 24 * 60 * 60_000,
    retry: false,
  }));

  const chain = createMemo<string[]>(() => {
    const out: string[] = [];
    const add = (url?: string | null) => {
      if (url && !out.includes(url)) out.push(url);
    };

    // 1. Instant cached studio artwork if available
    const hit = cachedArt();
    if (hit) {
      add(hit);
    }

    // 2. High-res catalogue studio artwork lookup takes priority over video stills
    if (catalogArtwork.data?.thumb) {
      add(catalogArtwork.data.thumb);
      if (props.track && !isVideoThumbnail(catalogArtwork.data.thumb)) {
        setCachedArtwork(props.track, catalogArtwork.data.thumb);
      }
    }
    if (props.candidates) {
      props.candidates.forEach(add);
      return out;
    }
    // Track's own artwork always takes priority over ambient list fallback
    add(props.src);
    add(props.track?.thumb);
    if (props.track && props.track.thumb && !isVideoThumbnail(props.track.thumb)) {
      setCachedArtwork(props.track, props.track.thumb);
    }
    // Ambient fallback (e.g. album sleeve) only when track has no artwork or if it fails
    add(props.fallbackSrc);

    return out;
  });

  // A different picture reusing this instance starts over on its own chain.
  createEffect(
    on(
      () => chain()[0] ?? null,
      () => {
        setAttempt(0);
        setBroken(false);
      },
      { defer: true },
    ),
  );

  const url = () => chain()[Math.min(attempt(), Math.max(0, chain().length - 1))] ?? null;
  const sized = () => {
    const value = url();
    return value ? sizedArtwork(value, props.displayWidth, props.aspect ?? 1) : null;
  };

  return (
    <div
      class={props.class ? `${frame} ${props.class}` : frame}
      style={{ 'aspect-ratio': String(props.aspect ?? 1), 'border-radius': props.radius }}
    >
      <Show when={!broken() && sized()}>
        {(source) => (
          <img
            class="absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out"
            src={source()}
            alt=""
            // googleusercontent throttles hotlinked images (429) by Referer.
            referrerPolicy="no-referrer"
            loading={props.eager ? 'eager' : 'lazy'}
            fetchpriority={props.eager ? 'high' : 'auto'}
            decoding="async"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              // YouTube returns a 120x90 pixel gray deleted/unavailable placeholder on HTTP 200
              if (img.naturalWidth === 120 && img.naturalHeight === 90 && isVideoThumbnail(img.currentSrc || img.src)) {
                setSawDeadThumb(true);
                const list = chain();
                const nextNonYt = list.findIndex((u, idx) => idx > attempt() && !isVideoThumbnail(u));
                if (nextNonYt >= 0) {
                  setAttempt(nextNonYt);
                } else {
                  setBroken(true);
                }
              }
            }}
            onError={() => {
              if (attempt() < chain().length - 1) setAttempt(attempt() + 1);
              else setBroken(true);
            }}
          />
        )}
      </Show>
    </div>
  );
}
