import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { Track } from '@/lib/types';
import { api } from '@/lib/api';
import { audio, playerStore, subscribeProgress } from '@/store/player';

interface MvPlayerProps {
  track: Track;
  active: boolean;
  onVideo?: (video: HTMLVideoElement | null) => void;
  onAvailable?: (available: boolean) => void;
  onStreamSrc?: (src: string | null) => void;
  class?: string;
}

/**
 * High-definition, hardware-accelerated YouTube Music Video Player.
 * Stretches cleanly to 16:9 with edge-to-edge crop-fill for black bars,
 * instantaneous seekbar tracking, and smooth zero-black-screen transitions over artwork.
 */
export function MvPlayer(props: MvPlayerProps) {
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  const mvQuery = useQuery(() => ({
    queryKey: ['mv-resolve-v2', props.track.id, props.track.title, (props.track.artists || []).join('|')],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.resolveMv(props.track, signal),
    staleTime: 24 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
    retry: 1,
    enabled: !!props.track?.title,
  }));

  const videoId = () => mvQuery.data?.videoId || null;

  createEffect(() => {
    const id = videoId();
    props.onAvailable?.(!!id);
  });

  const streamSrc = () => {
    const id = videoId();
    if (!id) return null;
    // Direct same-origin 1080p/720p hardware-accelerated stream via RFC 7233 byte-range proxy
    return `/api/video/${encodeURIComponent(id)}`;
  };

  createEffect(() => {
    props.onStreamSrc?.(streamSrc());
  });

  // Active playback state and source synchronization
  createEffect(() => {
    const el = videoEl();
    const src = streamSrc();
    if (!el || !props.active || !src) return;

    el.muted = true;
    el.defaultMuted = true;
    if (el.readyState >= 1) {
      setLoaded(true);
    }
    const audioTime = audio.currentTime || 0;
    if (Math.abs(el.currentTime - audioTime) > 0.3) {
      el.currentTime = audioTime;
    }
    if (playerStore.playing && !audio.paused && document.visibilityState === 'visible') {
      el.play().catch(() => {});
    }
  });

  // Sync play/pause directly with audio element and playerStore
  createEffect(() => {
    const el = videoEl();
    if (!el || !props.active) return;
    el.muted = true;

    const onPlay = () => {
      if (props.active && document.visibilityState === 'visible') {
        el.muted = true;
        el.play().catch(() => {});
      }
    };
    const onPause = () => {
      el.pause();
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlay);
    audio.addEventListener('pause', onPause);

    if (playerStore.playing && !audio.paused && document.visibilityState === 'visible') {
      el.play().catch(() => {});
    } else {
      el.pause();
    }

    onCleanup(() => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlay);
      audio.removeEventListener('pause', onPause);
    });
  });

  // High-precision seek synchronization: instant sync on audio seek and rAF progress
  createEffect(() => {
    const el = videoEl();
    if (!el || !props.active) return;

    const doSync = () => {
      const audioTime = audio.currentTime || 0;
      if (Math.abs(el.currentTime - audioTime) > 0.25) {
        el.currentTime = audioTime;
      }
    };

    audio.addEventListener('seeked', doSync);
    audio.addEventListener('seeking', doSync);

    // Initial seek alignment
    doSync();

    // rAF loop progress listener to keep video locked with audio with zero timer drift
    const unsub = subscribeProgress((cur) => {
      if (!props.active || document.hidden) return;
      if (Math.abs(el.currentTime - cur) > 0.35) {
        el.currentTime = cur;
      }
    });

    onCleanup(() => {
      audio.removeEventListener('seeked', doSync);
      audio.removeEventListener('seeking', doSync);
      unsub();
    });
  });

  // Reset loaded state on track switch
  createEffect(() => {
    props.track.id;
    setLoaded(false);
  });

  // Report video element to parent
  createEffect(() => {
    const el = videoEl();
    if (props.active && el && loaded()) {
      props.onVideo?.(el);
    } else {
      props.onVideo?.(null);
    }
  });

  return (
    <Show when={props.active && videoId()}>
      <div class={`group/mv relative size-full overflow-hidden ${props.class || ''}`}>
        <video
          ref={(el) => {
            setVideoEl(el);
            if (el) {
              el.muted = true;
              el.defaultMuted = true;
              el.playsInline = true;
            }
          }}
          autoplay
          muted
          playsinline
          preload="auto"
          src={streamSrc() || undefined}
          onPlay={() => setLoaded(true)}
          onPlaying={() => setLoaded(true)}
          onTimeUpdate={() => setLoaded(true)}
          onProgress={() => {
            const el = videoEl();
            if (el && el.readyState >= 1) setLoaded(true);
          }}
          onCanPlay={() => {
            setLoaded(true);
            const el = videoEl();
            if (el && props.active && playerStore.playing && !audio.paused) {
              el.muted = true;
              el.play().catch(() => {});
            }
          }}
          onLoadedData={() => {
            setLoaded(true);
            const el = videoEl();
            if (el && props.active && playerStore.playing && !audio.paused) {
              el.muted = true;
              el.play().catch(() => {});
            }
          }}
          onError={(e) => {
            console.warn('[MvPlayer] video playback error:', e);
          }}
          class="size-full transition-opacity duration-500 ease-out will-change-[opacity,transform] object-cover"
          classList={{
            'opacity-100 pointer-events-auto': loaded(),
            'opacity-0 pointer-events-none': !loaded(),
          }}
        />
      </div>
    </Show>
  );
}
