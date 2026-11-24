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
  class?: string;
}

interface Fit {
  scale: number;
  shiftX: number;
  shiftY: number;
  effectiveAspect?: number;
}

let sharedBarCanvas: HTMLCanvasElement | null = null;
let sharedBarCtx: CanvasRenderingContext2D | null = null;

function detectBars(video: HTMLVideoElement): Fit | null {
  try {
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    const S = 64;
    if (!sharedBarCanvas) {
      sharedBarCanvas = document.createElement('canvas');
      sharedBarCanvas.width = S;
      sharedBarCanvas.height = S;
      sharedBarCtx = sharedBarCanvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = sharedBarCtx;
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);

    // 1. Guard against blank / dark intro frames
    let centerLumaSum = 0;
    const cStart = 20;
    const cEnd = 44;
    const cCount = (cEnd - cStart) * (cEnd - cStart);
    for (let y = cStart; y < cEnd; y++) {
      for (let x = cStart; x < cEnd; x++) {
        const i = (y * S + x) * 4;
        centerLumaSum += data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
      }
    }
    if (centerLumaSum / cCount < 14) {
      return null;
    }

    // 2. Check top & bottom horizontal rows (letterbox bars)
    const rowIsBar = (row: number) => {
      let sum = 0;
      let peak = 0;
      for (let x = 0; x < S; x++) {
        const i = (row * S + x) * 4;
        const luma = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
        sum += luma;
        if (luma > peak) peak = luma;
      }
      return sum / S < 18 && peak < 45;
    };

    let top = 0;
    while (top < 26 && rowIsBar(top)) top++;
    let bottom = 0;
    while (bottom < 26 && rowIsBar(S - 1 - bottom)) bottom++;

    // 3. Check left & right vertical columns (pillarbox bars)
    const colIsBar = (col: number) => {
      let sum = 0;
      let peak = 0;
      for (let y = 0; y < S; y++) {
        const i = (y * S + col) * 4;
        const luma = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
        sum += luma;
        if (luma > peak) peak = luma;
      }
      return sum / S < 18 && peak < 45;
    };

    let left = 0;
    while (left < 26 && colIsBar(left)) left++;
    let right = 0;
    while (right < 26 && colIsBar(S - 1 - right)) right++;

    const vBars = (top + bottom) / S;
    const hBars = (left + right) / S;

    if (vBars < 0.04 && hBars < 0.04) {
      return null;
    }

    const scaleY = vBars > 0.04 ? 1 / Math.max(0.25, 1 - vBars) : 1;
    const scaleX = hBars > 0.04 ? 1 / Math.max(0.25, 1 - hBars) : 1;
    const scale = Math.min(2.2, Math.max(scaleX, scaleY));
    const shiftX = ((right - left) / S) * 50;
    const shiftY = ((bottom - top) / S) * 50;

    let effectiveAspect: number | undefined;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const rawAspect = video.videoWidth / video.videoHeight;
      const contentW = 1 - hBars;
      const contentH = 1 - vBars;
      effectiveAspect = rawAspect * (contentW / Math.max(0.1, contentH));
    }

    return { scale, shiftX, shiftY, effectiveAspect };
  } catch {
    return null;
  }
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
    setFit(null);
  });

  // Notify parent of ready state
  createEffect(() => {
    props.onReady?.(props.active && loaded());
  });

  // Letterbox and pillarbox auto-crop detection
  const [fit, setFit] = createSignal<Fit | null>(null);
  createEffect(() => {
    const el = videoEl();
    if (!loaded() || !el || !props.active) return;
    const checkBars = () => {
      const detected = detectBars(el);
      if (detected) setFit(detected);
    };
    const t1 = window.setTimeout(checkBars, 600);
    const t2 = window.setTimeout(checkBars, 2000);
    const t3 = window.setTimeout(checkBars, 5000);
    onCleanup(() => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    });
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
          style={{
            transform: fit() ? `scale(${fit()!.scale}) translate(${fit()!.shiftX}%, ${fit()!.shiftY}%)` : undefined,
            'transition-property': 'transform, opacity',
            'transition-duration': '700ms',
            'transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          classList={{
            'opacity-100 pointer-events-auto': loaded(),
            'opacity-0 pointer-events-none': !loaded(),
          }}
        />
      </div>
    </Show>
  );
}
