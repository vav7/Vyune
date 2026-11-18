import { createEffect, createSignal, onCleanup, onMount, Show, type Accessor } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { type ArtMode, artModeStore } from '@/store/artMode';
import type { Track } from '@/lib/types';
import { api, videoStreamUrl } from '@/lib/api';
import { attachHlsClip, type ClipHandle } from '@/lib/hlsClip';
import { useTier } from '@/lib/perf';
import { audio, playerStore, subscribeProgress } from '@/store/player';

const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function useReducedMotion(): Accessor<boolean> {
  const [reduced, setReduced] = createSignal(reducedMotionQuery?.matches ?? false);
  const listener = () => setReduced(reducedMotionQuery?.matches ?? false);
  reducedMotionQuery?.addEventListener('change', listener);
  onCleanup(() => reducedMotionQuery?.removeEventListener('change', listener));
  return reduced;
}

interface Fit {
  scale: number;
  shiftX: number;
  shiftY: number;
  effectiveAspect?: number;
}

function detectBars(video: HTMLVideoElement): Fit | null {
  try {
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    const canvas = document.createElement('canvas');
    const S = 64;
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
 * Full Music Video Player (Mode 3: 'mv')
 * Plays official YouTube music video in tight lockstep with the audio engine.
 */
function MvPlayer(props: {
  track: Track;
  onVideo?: (video: HTMLVideoElement | null) => void;
  onAspect?: (aspect: number) => void;
}) {
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = createSignal(false);
  const [fit, setFit] = createSignal<Fit | null>(null);

  // 1. Resolve official music video
  const ytMvQuery = useQuery(() => ({
    queryKey: ['yt-mv-v6', props.track.id, props.track.title, (props.track.artists || []).join('|')],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.resolveMv(props.track, signal),
    staleTime: 24 * 3600_000,
    gcTime: 48 * 3600_000,
  }));

  const videoId = () => ytMvQuery.data?.videoId || (props.track.source === 'yt' ? props.track.id : null);
  const videoSrc = () => (videoId() ? videoStreamUrl(videoId()!) : null);

  // 2. Play / Pause synchronization with Solid store (runs reactively on mount & state change)
  createEffect(() => {
    const el = videoEl();
    if (!el) return;
    const isPlaying = playerStore.playing;
    if (isPlaying && el.paused) {
      el.play().catch(() => {});
    } else if (!isPlaying && !el.paused) {
      el.pause();
    }
  });

  // 3. High-precision cinematic drift correction & seek synchronization
  onMount(() => {
    const unsub = subscribeProgress((cur) => {
      const el = videoEl();
      if (!el || el.seeking || !playerStore.playing || !videoReady() || el.readyState < 2) return;
      const drift = el.currentTime - cur;
      // If drift is substantial (> 2.0s, e.g. large scrubber jump), seek directly
      if (Math.abs(drift) > 2.0) {
        el.currentTime = cur;
        el.playbackRate = 1.0;
        return;
      }
      // Micro-drift correction: smoothly nudge playback rate (±5%) for butter-smooth 60fps sync without re-buffering
      if (drift < -0.15) {
        el.playbackRate = 1.05;
      } else if (drift > 0.15) {
        el.playbackRate = 0.95;
      } else {
        el.playbackRate = 1.0;
      }
    });

    const onSeeked = () => {
      const el = videoEl();
      if (el && Number.isFinite(audio.currentTime)) {
        el.currentTime = audio.currentTime;
        el.playbackRate = 1.0;
      }
    };
    audio.addEventListener('seeked', onSeeked);

    onCleanup(() => {
      unsub();
      audio.removeEventListener('seeked', onSeeked);
    });
  });

  // 4. Zero-Black-Bars active detector: scans frames and scales out any encoded letterbox/pillarbox
  createEffect(() => {
    const el = videoEl();
    if (!videoReady() || !el) return;
    const checkBars = () => {
      const detected = detectBars(el);
      if (detected) {
        setFit(detected);
        if (detected.effectiveAspect) {
          props.onAspect?.(detected.effectiveAspect);
        }
      }
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

  createEffect(() => {
    const el = videoReady() ? videoEl() : null;
    props.onVideo?.(el);
    onCleanup(() => props.onVideo?.(null));
  });

  return (
    <div class="relative size-full overflow-hidden rounded-[inherit]">
      <Show when={videoSrc()} fallback={null}>
        {(src) => (
          <video
            ref={setVideoEl}
            src={src()}
            crossorigin="anonymous"
            autoplay
            muted
            playsinline
            preload="auto"
            loop
            aria-hidden="true"
            class={`absolute inset-0 z-10 size-full rounded-[inherit] object-cover transition-opacity duration-700 ease-in-out ${
              videoReady() ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              transform: fit() ? `scale(${fit()!.scale}) translate(${fit()!.shiftX}%, ${fit()!.shiftY}%)` : undefined,
              'transition-property': 'transform, opacity',
              'transition-duration': '700ms',
              'transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              const w = el.videoWidth;
              const h = el.videoHeight;
              if (w > 0 && h > 0) props.onAspect?.(w / h);
              if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
                el.currentTime = audio.currentTime;
              }
              if (playerStore.playing && el.paused) {
                el.play().catch(() => {});
              }
            }}
            onCanPlay={(e) => {
              setVideoReady(true);
              if (playerStore.playing && e.currentTarget.paused) {
                e.currentTarget.play().catch(() => {});
              }
            }}
            onPlaying={() => setVideoReady(true)}
            onTimeUpdate={(e) => {
              if (!videoReady() && e.currentTarget.currentTime > 0) {
                setVideoReady(true);
              }
            }}
            onError={(e) => {
              console.warn('[MvPlayer] error loading video:', e);
              setVideoReady(false);
            }}
          />
        )}
      </Show>

      {/* Luxury GlassCN Buffering Badge */}
      <Show when={!videoReady() && !!videoSrc()}>
        <div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[3px] transition-opacity duration-500">
          <div class="flex items-center gap-2 rounded-full border border-white/20 bg-black/70 px-4 py-2 backdrop-blur-xl shadow-2xl">
            <span class="size-2 rounded-full bg-red-500 animate-ping" />
            <span class="text-[11px] font-bold tracking-wider text-white uppercase [font-family:var(--font-display)]">Buffering MV...</span>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Visualizer Player (Mode 2: 'visualiser')
 * Cycles: Live Album Art (25s) -> 30s clips of each MV version -> Loops seamlessly
 */
function VisualizerPlayer(props: {
  track: Track;
  onVideo?: (video: HTMLVideoElement | null) => void;
  onAspect?: (aspect: number) => void;
}) {
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  const [ready, setReady] = createSignal(false);
  const [fit, setFit] = createSignal<Fit | null>(null);
  const [visualizerPhase, setVisualizerPhase] = createSignal<'live_art' | 'mv_clip'>('live_art');
  const [currentMvIndex, setCurrentMvIndex] = createSignal(0);
  let hlsHandle: ClipHandle | null = null;

  // Query Apple motion art
  const appleMotionQuery = useQuery(() => ({
    queryKey: [
      'apple-motion-v4',
      props.track.id,
      props.track.title,
      (props.track.artists || []).join('|'),
      props.track.album,
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.appleMotion(props.track, signal),
    staleTime: 24 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
  }));

  // Query YouTube MV fallback
  const ytMvQuery = useQuery(() => ({
    queryKey: [
      'yt-mv-visualizer',
      props.track.id,
      props.track.title,
      (props.track.artists || []).join('|'),
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.resolveMv(props.track, signal),
    staleTime: 24 * 60 * 60_000,
  }));

  const liveAlbumArtUrl = () => appleMotionQuery.data?.url || null;

  const mvVersions = () => {
    const appleList = appleMotionQuery.data?.mvs?.length
      ? appleMotionQuery.data.mvs
      : appleMotionQuery.data?.mv
        ? [appleMotionQuery.data.mv]
        : [];
    const valid = appleList.filter((v) => v?.url);
    if (valid.length > 0) {
      return valid.map((item, idx) => ({
        url: item.url,
        aspect: item.aspect || 16 / 9,
        title: item.title || `Music Video ${idx + 1}`,
        label: item.label || 'Music Video',
      }));
    }

    // Fallback: YouTube MV clip
    const ytVideoId = ytMvQuery.data?.videoId || (props.track.source === 'yt' ? props.track.id : null);
    if (ytVideoId) {
      return [
        {
          url: videoStreamUrl(ytVideoId),
          aspect: 16 / 9,
          title: ytMvQuery.data?.title || 'Official Music Video',
          label: 'Official Music Video',
        },
      ];
    }
    return [];
  };

  createEffect(() => {
    const versions = mvVersions();
    if (versions.length > 0) {
      artModeStore.setVersions(versions.map((v) => v.label || v.title));
    }
  });

  // Reset on track change
  createEffect(() => {
    props.track.id;
    setCurrentMvIndex(0);
    setVisualizerPhase(liveAlbumArtUrl() ? 'live_art' : 'mv_clip');
  });

  // Cycle Visualizer timer
  createEffect(() => {
    const hasLiveArt = !!liveAlbumArtUrl();
    const versions = mvVersions();
    if (!hasLiveArt && versions.length === 0) return;

    const currentPhase = visualizerPhase();
    const durationSeconds = currentPhase === 'live_art' ? 25 : 30;

    let secondsPassed = 0;
    const interval = window.setInterval(() => {
      if (playerStore.playing) {
        secondsPassed++;
        if (secondsPassed >= durationSeconds) {
          secondsPassed = 0;
          if (currentPhase === 'live_art') {
            if (versions.length > 0) {
              setVisualizerPhase('mv_clip');
              setCurrentMvIndex(0);
              artModeStore.setVisualizerPhase('mv_clip');
              artModeStore.setVersionIndex(0);
            }
          } else {
            const nextIdx = currentMvIndex() + 1;
            if (nextIdx < versions.length) {
              setCurrentMvIndex(nextIdx);
              artModeStore.setVersionIndex(nextIdx);
            } else {
              if (hasLiveArt) {
                setVisualizerPhase('live_art');
                artModeStore.setVisualizerPhase('live_art');
              } else {
                setCurrentMvIndex(0);
                artModeStore.setVersionIndex(0);
              }
            }
          }
        }
      }
    }, 1000);

    onCleanup(() => window.clearInterval(interval));
  });

  const activeSource = () => {
    const hasLiveArt = !!liveAlbumArtUrl();
    const versions = mvVersions();

    if (visualizerPhase() === 'live_art' && hasLiveArt) {
      return liveAlbumArtUrl();
    }

    if (versions.length > 0) {
      const item = versions[currentMvIndex() % versions.length];
      return item?.url || liveAlbumArtUrl();
    }

    return liveAlbumArtUrl();
  };

  const activeAspect = () => {
    if (visualizerPhase() === 'live_art') {
      return appleMotionQuery.data?.aspect ?? 1;
    }
    const versions = mvVersions();
    if (versions.length > 0) {
      return versions[currentMvIndex() % versions.length]?.aspect ?? 16 / 9;
    }
    return 1;
  };

  // Mount/attach video
  createEffect(() => {
    const src = activeSource();
    const el = videoEl();
    setReady(false);
    setFit(null);
    if (!el || !src) return;

    if (/\.m3u8(?:$|\?)/i.test(src)) {
      let cancelled = false;
      void attachHlsClip(el, src, { maxBufferLength: 8 }).then((attached) => {
        if (cancelled) attached?.destroy();
        else hlsHandle = attached;
      });
      onCleanup(() => {
        cancelled = true;
        hlsHandle?.destroy();
        hlsHandle = null;
        el.pause();
      });
    } else {
      el.src = src;
      el.load();
      if (playerStore.playing) el.play().catch(() => {});
      onCleanup(() => {
        el.pause();
      });
    }
  });

  // Play/pause sync with Solid store
  createEffect(() => {
    const el = videoEl();
    if (!el) return;
    const isPlaying = playerStore.playing;
    if (isPlaying && el.paused) {
      el.play().catch(() => {});
    } else if (!isPlaying && !el.paused) {
      el.pause();
    }
  });

  createEffect(() => {
    const ratio = activeAspect();
    if (props.onAspect && ratio > 0) props.onAspect(ratio);
  });

  createEffect(() => {
    const el = ready() && activeSource() ? videoEl() : null;
    props.onVideo?.(el);
    onCleanup(() => props.onVideo?.(null));
  });

  createEffect(() => {
    const el = videoEl();
    if (!ready() || !el) return;
    const checkBars = () => {
      const detected = detectBars(el);
      if (detected) {
        setFit(detected);
        if (detected.effectiveAspect) {
          props.onAspect?.(detected.effectiveAspect);
        }
      }
    };
    const t1 = window.setTimeout(checkBars, 600);
    const t2 = window.setTimeout(checkBars, 2000);
    onCleanup(() => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    });
  });

  return (
    <Show when={activeSource()} fallback={null}>
      <video
        ref={setVideoEl}
        crossorigin="anonymous"
        autoplay
        muted
        playsinline
        preload="auto"
        loop
        aria-hidden="true"
        class={`pointer-events-none absolute inset-0 z-10 size-full rounded-[inherit] object-cover transition-opacity duration-700 ease-in-out ${
          ready() ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          transform: fit() ? `scale(${fit()!.scale}) translate(${fit()!.shiftX}%, ${fit()!.shiftY}%)` : undefined,
          'transition-property': 'transform, opacity',
          'transition-duration': '700ms',
          'transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        onCanPlay={() => {
          setReady(true);
          if (playerStore.playing && videoEl()?.paused) videoEl()?.play().catch(() => {});
        }}
        onPlaying={() => setReady(true)}
        onTimeUpdate={(e) => {
          if (!ready() && e.currentTarget.currentTime > 0) setReady(true);
        }}
        onError={() => setReady(false)}
      />
    </Show>
  );
}

/**
 * Master presentation component that renders the selected mode:
 *   - 'art': Clean static artwork (no video mounted)
 *   - 'visualiser': VisualizerPlayer (live album art -> 30s clips -> loop)
 *   - 'mv': MvPlayer (full synced YouTube music video at 60fps)
 */
export function AppleMotionArtwork(props: {
  track: Track;
  mode?: ArtMode;
  onVideo?: (video: HTMLVideoElement | null) => void;
  onAspect?: (aspect: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const tier = useTier();
  const mode = () => props.mode ?? artModeStore.mode;

  return (
    <Show when={!reduceMotion()}>
      <Show when={mode() === 'mv'}>
        <MvPlayer track={props.track} onVideo={props.onVideo} onAspect={props.onAspect} />
      </Show>
      <Show when={mode() === 'visualiser' && tier.motion}>
        <VisualizerPlayer track={props.track} onVideo={props.onVideo} onAspect={props.onAspect} />
      </Show>
    </Show>
  );
}
