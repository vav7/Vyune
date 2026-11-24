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
  onReady?: (ready: boolean) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  class?: string;
}

/**
 * High-definition, hardware-accelerated YouTube Music Video Player.
 * Stretches cleanly to 16:9 with subtle edge-to-edge crop-fill for black bars,
 * instantaneous seekbar tracking, and smooth zero-black-screen transitions over artwork.
 * Features automatic YouTube iframe fallback when direct proxy stream is challenged.
 */
export function MvPlayer(props: MvPlayerProps) {
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | null>(null);
  const [useIframe, setUseIframe] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [isPlaying, setIsPlaying] = createSignal(false);

  const updatePlayingState = () => {
    const el = videoEl();
    if (useIframe()) {
      setIsPlaying(loaded() && playerStore.playing && !audio.paused);
      return;
    }
    const playing = !!(
      el &&
      !el.paused &&
      !el.ended &&
      el.readyState >= 2 &&
      el.currentTime > 0.05
    );
    setIsPlaying(playing);
  };

  createEffect(() => {
    props.onPlayingChange?.(isPlaying());
  });

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
    return `/api/video/${encodeURIComponent(id)}`;
  };

  createEffect(() => {
    props.onStreamSrc?.(streamSrc());
  });

  // PostMessage helper for embedded YouTube player
  function sendIframeCommand(func: string, args: any[] = []) {
    const ifr = iframeEl();
    if (!ifr?.contentWindow) return;
    ifr.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args,
      }),
      '*'
    );
  }

  // Active playback state and source synchronization for <video>
  createEffect(() => {
    const el = videoEl();
    const src = streamSrc();
    if (!el || !props.active || !src || useIframe()) return;

    el.muted = true;
    el.defaultMuted = true;
    if (el.readyState >= 1) {
      setLoaded(true);
    }
    const audioTime = audio.currentTime || 0;
    if (Math.abs(el.currentTime - audioTime) > 0.5) {
      el.currentTime = audioTime;
    }
    if (playerStore.playing && !audio.paused && document.visibilityState === 'visible') {
      el.play().catch(() => {});
    }
  });

  // Sync play/pause directly with audio element and playerStore
  createEffect(() => {
    if (!props.active) return;

    const onPlay = () => {
      if (!props.active || document.visibilityState !== 'visible') return;
      if (useIframe()) {
        sendIframeCommand('playVideo');
      } else {
        const el = videoEl();
        if (el) {
          el.muted = true;
          el.play().catch(() => {});
        }
      }
      updatePlayingState();
    };

    const onPause = () => {
      if (useIframe()) {
        sendIframeCommand('pauseVideo');
      } else {
        const el = videoEl();
        if (el) el.pause();
      }
      updatePlayingState();
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlay);
    audio.addEventListener('pause', onPause);

    if (playerStore.playing && !audio.paused && document.visibilityState === 'visible') {
      onPlay();
    } else {
      onPause();
    }

    onCleanup(() => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlay);
      audio.removeEventListener('pause', onPause);
    });
  });

  // PLL Phase-Locked Loop micro-sync: steers playbackRate without decoder flushes or stuttering
  createEffect(() => {
    if (!props.active) return;

    const onSeek = () => {
      const audioTime = audio.currentTime || 0;
      if (useIframe()) {
        sendIframeCommand('seekTo', [audioTime, true]);
      } else {
        const el = videoEl();
        if (el) {
          el.playbackRate = 1.0;
          el.currentTime = audioTime;
        }
      }
    };

    audio.addEventListener('seeked', onSeek);
    audio.addEventListener('seeking', onSeek);
    onSeek();

    // rAF loop progress listener to keep video locked with audio with zero timer drift
    let lastIframeSeek = 0;
    const unsub = subscribeProgress((cur) => {
      if (!props.active || document.hidden) return;

      if (useIframe()) {
        // Iframe periodic alignment check
        const now = Date.now();
        if (now - lastIframeSeek > 3500) {
          lastIframeSeek = now;
          sendIframeCommand('seekTo', [cur, true]);
        }
        return;
      }

      const el = videoEl();
      if (!el || el.seeking) return;
      const delta = cur - el.currentTime; // + means video is behind audio
      if (Math.abs(delta) > 0.8 && el.readyState >= 2) {
        el.playbackRate = 1.0;
        el.currentTime = cur; // hard seek only on real scrub
      } else if (Math.abs(delta) > 0.04) {
        el.playbackRate = Math.min(1.08, Math.max(0.92, 1.0 + delta * 0.45));
      } else {
        el.playbackRate = 1.0;
      }
    });

    onCleanup(() => {
      audio.removeEventListener('seeked', onSeek);
      audio.removeEventListener('seeking', onSeek);
      unsub();
    });
  });

  // Reset loaded and playing state strictly on track switch
  let lastMvTrackId: string | null = null;
  createEffect(() => {
    const curId = props.track?.id || null;
    if (curId !== lastMvTrackId) {
      lastMvTrackId = curId;
      setLoaded(false);
      setIsPlaying(false);
      setUseIframe(false);
    }
  });

  // Fallback timer: if <video> does not become ready within 3.5s, switch to iframe embed
  createEffect(() => {
    const active = props.active;
    const id = videoId();
    if (!active || !id || useIframe() || loaded()) return;

    const timer = window.setTimeout(() => {
      const el = videoEl();
      if (!loaded() && (!el || el.readyState < 2)) {
        console.info('[MvPlayer] video element timeout, falling back to YouTube player');
        setUseIframe(true);
      }
    }, 3500);

    onCleanup(() => window.clearTimeout(timer));
  });

  // Notify parent of ready state
  createEffect(() => {
    props.onReady?.(props.active && loaded());
  });

  // Report video element to parent (for WebGL background sampling when video is available)
  createEffect(() => {
    const el = videoEl();
    if (props.active && el && loaded() && !useIframe()) {
      props.onVideo?.(el);
    } else {
      props.onVideo?.(null);
    }
  });

  return (
    <Show when={props.active && videoId()}>
      <div class={`group/mv relative size-full overflow-hidden bg-black ${props.class || ''}`}>
        <Show
          when={!useIframe()}
          fallback={
            <iframe
              ref={(el) => setIframeEl(el)}
              src={`https://www.youtube-nocookie.com/embed/${videoId()}?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&loop=1&origin=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '')}`}
              class="size-full pointer-events-auto border-0 object-cover select-none transition-opacity duration-700 ease-out"
              allow="autoplay; encrypted-media; picture-in-picture"
              style={{
                transform: 'scale(1.15)',
                'transform-origin': 'center center',
              }}
              classList={{
                'opacity-100': loaded(),
                'opacity-0': !loaded(),
              }}
              onLoad={() => {
                setLoaded(true);
                setIsPlaying(true);
                sendIframeCommand('seekTo', [audio.currentTime || 0, true]);
                if (playerStore.playing && !audio.paused) {
                  sendIframeCommand('playVideo');
                }
              }}
            />
          }
        >
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
            onPlay={() => {
              setLoaded(true);
              updatePlayingState();
            }}
            onPlaying={() => {
              setLoaded(true);
              updatePlayingState();
            }}
            onPause={() => updatePlayingState()}
            onWaiting={() => updatePlayingState()}
            onTimeUpdate={() => {
              setLoaded(true);
              updatePlayingState();
            }}
            onProgress={() => {
              const el = videoEl();
              if (el && el.readyState >= 1) setLoaded(true);
            }}
            onCanPlay={() => {
              setLoaded(true);
              updatePlayingState();
              const el = videoEl();
              if (el && props.active && playerStore.playing && !audio.paused) {
                el.muted = true;
                el.play().catch(() => {});
              }
            }}
            onLoadedData={() => {
              setLoaded(true);
              updatePlayingState();
              const el = videoEl();
              if (el && props.active && playerStore.playing && !audio.paused) {
                el.muted = true;
                el.play().catch(() => {});
              }
            }}
            onError={(e) => {
              console.warn('[MvPlayer] video element error, falling back to YouTube player:', e);
              setUseIframe(true);
            }}
            class="size-full transition-opacity duration-500 ease-out will-change-[opacity,transform] object-cover"
            style={{
              transform: 'scale(1.08)',
              'transform-origin': 'center center',
            }}
            classList={{
              'opacity-100 pointer-events-auto': loaded(),
              'opacity-0 pointer-events-none': !loaded(),
            }}
          />
        </Show>
      </div>
    </Show>
  );
}
