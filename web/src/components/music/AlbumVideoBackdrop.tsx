import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { api } from '@/lib/api';
import { attachHlsClip, type ClipHandle } from '@/lib/hlsClip';
import { useTier } from '@/lib/perf';
import { MotionFrost } from './MotionFrost';
import { albumVideoStore } from '@/store/albumVideo';
import type { Track } from '@/lib/types';

const BATCH = 3;
const MAX_TRACKS = 15;

/**
 * Every music video of the album (or playlist), one after another, behind the
 * page. Videos are looked up a few songs at a time, so the first one starts as
 * soon as it is found and the rest join the rotation as they turn up.
 * Tapping the poster turns the whole thing off (and back on).
 */
export function AlbumVideoBackdrop({ tracks }: { tracks: Track[] }) {
  const on = () => albumVideoStore.on;
  const { motion } = useTier();
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const wanted = () => on() && motion && reducedMotion && !reducedMotion.matches;

  const pool = createMemo(() => tracks.filter((t) => t.title && t.artists?.length).slice(0, MAX_TRACKS));
  const [limit, setLimit] = createSignal(BATCH);
  createEffect(() => {
    pool();
    setLimit(BATCH);
  });

  // Batch queries — each track gets its own query entry.
  const queries = pool().slice(0, limit()).map((track) =>
    useQuery(() => ({
      queryKey: ['apple-motion-v2', track.id, track.title, (track.artists || []).join('|'), track.album],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.appleMotion(track, signal),
      enabled: wanted(),
      staleTime: 24 * 3600_000,
      gcTime: 48 * 3600_000,
      retry: 1,
      retryDelay: 800,
    }))
  );

  const settled = createMemo(() => queries.length > 0 && queries.every((q) => !q.isPending));
  createEffect(() => {
    if (wanted() && settled() && limit() < pool().length) setLimit((n) => n + BATCH);
  });

  const urls = createMemo(() => {
    const seen = new Set<string>();
    for (const q of queries) {
      const url = (q.data?.mvs?.find((v) => !/lyric/i.test(`${v.label ?? ''} ${v.title ?? ''}`)) ?? q.data?.mv)?.url;
      if (url && !seen.has(url)) seen.add(url);
    }
    return Array.from(seen);
  });

  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  let video: HTMLVideoElement | null = null;
  let handle: ClipHandle | null = null;
  const [index, setIndex] = createSignal(0);
  const [shown, setShown] = createSignal(false);

  const url = createMemo(() => {
    const u = urls();
    return u.length ? u[index() % u.length]! : null;
  });

  createEffect(() => {
    const element = video;
    const src = url();
    setShown(false);
    if (!element || !src || !wanted()) return;
    let cancelled = false;
    void attachHlsClip(element, src, { maxBufferLength: 8 }).then((attached) => {
      if (cancelled) {
        attached?.destroy();
        return;
      }
      handle = attached;
      element.play().catch(() => undefined);
    });
    onCleanup(() => {
      cancelled = true;
      handle?.destroy();
      handle = null;
      element.pause();
    });
  });

  // Pause with the tab; carry on to the next video when one ends (a lone video simply loops).
  createEffect(() => {
    const element = video;
    if (!element) return;
    const onEnded = () => {
      const u = urls();
      if (u.length < 2) {
        element.currentTime = 0;
        void element.play().catch(() => undefined);
        return;
      }
      setShown(false);
      window.setTimeout(() => setIndex((i) => (i + 1) % u.length), 450);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void element.play().catch(() => undefined);
      else element.pause();
    };
    element.addEventListener('ended', onEnded);
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      element.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  return (
    <Show when={wanted() && urls().length > 0}>
      <div class="pointer-events-none sticky top-0 z-0 -mb-[100dvh] -ml-(--web-navigation-width) h-dvh animate-[fade-in_1.2s_ease_both] max-sm:ml-0" aria-hidden="true">
        {/* The clip plays unseen; every frame is frosted on the GPU (mip-chain blur + dither), so there is
            no full-screen CSS blur on a moving layer: it stays smooth, a little visible, never pixelated. */}
        <video
          ref={(el) => { video = el; setVideoEl(el); }}
          muted
          playsinline
          preload="auto"
          onPlaying={() => setShown(true)}
          class="pointer-events-none absolute left-0 top-0 h-[360px] w-[640px] opacity-0"
        />
        <div class={`absolute inset-0 transition-opacity duration-[900ms] ease-in-out ${shown() ? 'opacity-100' : 'opacity-0'}`}>
          <MotionFrost video={videoEl()} dim={0.3} detail={160} />
        </div>
      </div>
    </Show>
  );
}
