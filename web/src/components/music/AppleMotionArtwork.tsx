import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { Track } from '@/lib/types';
import { api } from '@/lib/api';
import { attachHlsClip, type ClipHandle } from '@/lib/hlsClip';
import { playerStore } from '@/store/player';
import { useTier } from '@/lib/perf';

interface AppleMotionArtworkProps {
  track: Track;
  mode?: string;
  banner?: boolean;
  onVideo?: (video: HTMLVideoElement | null) => void;
  onAspect?: (aspect: number) => void;
  onReady?: (ready: boolean) => void;
  appleOnly?: boolean;
  class?: string;
}

/**
 * Lightweight, premium Apple Motion Artwork player.
 * Plays official animated album art seamlessly stretched to the poster/banner container.
 * Zero CPU canvas readbacks, zero 60fps drift overhead, pure hardware-accelerated playback.
 */
export function AppleMotionArtwork(props: AppleMotionArtworkProps) {
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const tier = useTier();

  const motionQuery = useQuery(() => ({
    queryKey: ['apple-motion-v2', props.track.id, props.track.title, (props.track.artists || []).join('|'), props.track.album],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.appleMotion(props.track, signal),
    staleTime: 24 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
    retry: 1,
    enabled: !!props.track?.title,
  }));

  const motionUrl = () => {
    const data = motionQuery.data;
    if (!data) return null;
    return data.url || data.mv?.url || data.mvs?.[0]?.url || null;
  };

  const aspect = () => {
    const data = motionQuery.data;
    if (data?.aspect) return data.aspect;
    return props.banner ? 16 / 9 : 1;
  };

  createEffect(() => {
    const a = aspect();
    if (props.onAspect && a) {
      props.onAspect(a);
    }
  });

  // Attach and control HLS video
  createEffect(() => {
    const el = videoEl();
    const url = motionUrl();
    setLoaded(false);
    props.onReady?.(false);

    if (!el || !url || !tier.motion) {
      props.onVideo?.(null);
      return;
    }

    let handle: ClipHandle | null = null;
    let cancelled = false;

    void attachHlsClip(el, url, { maxBufferLength: 8 }).then((h) => {
      if (cancelled) {
        h?.destroy();
        return;
      }
      handle = h;
      props.onVideo?.(el);
      if (playerStore.playing) {
        el.play().catch(() => {});
      }
    });

    onCleanup(() => {
      cancelled = true;
      handle?.destroy();
      handle = null;
      props.onVideo?.(null);
      props.onReady?.(false);
      el.pause();
    });
  });

  // Sync play/pause with audio player
  createEffect(() => {
    const el = videoEl();
    if (!el) return;
    if (playerStore.playing && document.visibilityState === 'visible') {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  });

  return (
    <Show when={motionUrl() && tier.motion}>
      <div
        class={`relative size-full overflow-hidden ${props.class || ''}`}
        style={props.banner ? { width: '100%', height: '100%' } : undefined}
      >
        <video
          ref={setVideoEl}
          muted
          loop
          playsinline
          preload="auto"
          onLoadedData={() => {
            setLoaded(true);
            props.onReady?.(true);
          }}
          class={`size-full object-cover transition-opacity duration-500 ease-out ${
            loaded() ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    </Show>
  );
}
