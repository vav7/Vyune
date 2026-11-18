import { createEffect, createSignal, onCleanup, Show, type Accessor } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { type ArtMode, artModeStore } from '@/store/artMode';
import type { Track } from '@/lib/types';
import { api, videoStreamUrl } from '@/lib/api';
import { attachHlsClip, type ClipHandle } from '@/lib/hlsClip';
import { useTier } from '@/lib/perf';
import { playerStore } from '@/store/player';

const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Whether the system asks for less motion; it can change while the app runs. */
function useReducedMotion(): Accessor<boolean> {
  const [reduced, setReduced] = createSignal(reducedMotionQuery?.matches ?? false);
  const listener = () => setReduced(reducedMotionQuery?.matches ?? false);
  reducedMotionQuery?.addEventListener('change', listener);
  onCleanup(() => reducedMotionQuery?.removeEventListener('change', listener));
  return reduced;
}

/** How much to enlarge a clip so its own black letterbox bars fall outside the frame. */
interface Fit {
  scale: number;
  shift: number;
}

/** Looks for solid dark bars at the top and bottom of the picture. */
function detectBars(video: HTMLVideoElement): Fit | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 48, 48);
    const { data } = ctx.getImageData(0, 0, 48, 48);
    const rowIsBar = (row: number) => {
      let sum = 0;
      let peak = 0;
      for (let x = 0; x < 48; x++) {
        const i = (row * 48 + x) * 4;
        const luma = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
        sum += luma;
        peak = Math.max(peak, luma);
      }
      return sum / 48 < 14 && peak < 40;
    };
    let top = 0;
    while (top < 20 && rowIsBar(top)) top++;
    let bottom = 0;
    while (bottom < 20 && rowIsBar(47 - bottom)) bottom++;
    const bars = (top + bottom) / 48;
    if (bars < 0.08) return null;
    return { scale: Math.min(1.7, 1 / (1 - bars)), shift: ((bottom - top) / 48) * 50 };
  } catch {
    return null;
  }
}

/**
 * Three Player Presentation Modes:
 *   - 'art': Normal static high-resolution artwork (zero video overhead).
 *   - 'visualiser': Dynamic visualizer cycling Live Album Art -> 30s clips of all MV versions -> Loop.
 *   - 'mv': Full official YouTube Music Video streaming at 1080p/720p 60fps in tight lockstep with audio.
 */
export function AppleMotionArtwork(props: {
  track: Track;
  mode?: ArtMode;
  /** The clip to frost behind the player once it is playing (null when none). */
  onVideo?: (video: HTMLVideoElement | null) => void;
  /** The clip's width / height, so its frame can match it. */
  onAspect?: (aspect: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const tier = useTier();
  const [visible, setVisible] = createSignal(typeof document === 'undefined' || document.visibilityState === 'visible');

  const mode = () => props.mode ?? artModeStore.mode;
  const isArtMode = () => mode() === 'art';
  const isVisualizerMode = () => mode() === 'visualiser';
  const isMvMode = () => mode() === 'mv';

  const wanted = () => !reduceMotion() && !isArtMode() && (tier.motion || isMvMode());

  // Track visibility changes
  createEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    onCleanup(() => document.removeEventListener('visibilitychange', update));
  });

  // 1. Query Apple Motion and music video cuts
  const appleMotionQuery = useQuery(() => ({
    queryKey: [
      'apple-motion-v3',
      props.track.id,
      props.track.title,
      (props.track.artists || []).join('|'),
      props.track.album,
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.appleMotion(props.track, signal),
    enabled: wanted() && !!props.track.title,
    staleTime: 24 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
    retry: 1,
  }));

  // 2. Query official YouTube Music Video
  const ytMvQuery = useQuery(() => ({
    queryKey: [
      'yt-mv-resolve',
      props.track.id,
      props.track.title,
      (props.track.artists || []).join('|'),
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.resolveMv(props.track, signal),
    enabled: wanted() && !!props.track.title,
    staleTime: 24 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
    retry: 1,
  }));

  const liveAlbumArtUrl = () => appleMotionQuery.data?.url || null;

  // List of MV versions available for Visualizer mode (30s clips)
  const isLyricVideo = (v: { label?: string | null; title?: string | null }) =>
    /lyric/i.test(`${v.label ?? ''} ${v.title ?? ''}`);

  const mvVersions = () => {
    const appleList = appleMotionQuery.data?.mvs?.length
      ? appleMotionQuery.data.mvs
      : appleMotionQuery.data?.mv
        ? [appleMotionQuery.data.mv]
        : [];
    const nonLyric = appleList.filter((v) => !isLyricVideo(v as any));
    const list = nonLyric.length ? nonLyric : appleList;

    if (list.length > 0) {
      return list.map((item, idx) => ({
        url: item.url,
        aspect: item.aspect || 16 / 9,
        title: item.title || `Music Video ${idx + 1}`,
        label: item.label || 'Music Video',
      }));
    }

    // Fallback: If Apple has no MV preview, use the resolved YouTube MV as a 30s preview clip
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

  // Publish video versions to the global store for menus
  createEffect(() => {
    const versions = mvVersions();
    if (versions.length > 0) {
      artModeStore.setVersions(versions.map((v) => v.label || v.title));
    }
  });

  // -------------------------------------------------------------
  // Visualizer Rotation Engine:
  // Stage 0: Live album artwork (plays for 25 seconds)
  // Stage 1..N: 30-second clips of each MV version
  // Loops seamlessly back to Stage 0
  // -------------------------------------------------------------
  const [visualizerPhase, setVisualizerPhase] = createSignal<'live_art' | 'mv_clip'>('live_art');
  const [currentMvIndex, setCurrentMvIndex] = createSignal(0);

  // Reset on track change
  createEffect(() => {
    props.track.id;
    setCurrentMvIndex(0);
    setVisualizerPhase(liveAlbumArtUrl() ? 'live_art' : 'mv_clip');
  });

  // Cycle Visualizer timer
  createEffect(() => {
    if (!isVisualizerMode() || !visible()) return;
    const hasLiveArt = !!liveAlbumArtUrl();
    const versions = mvVersions();
    if (!hasLiveArt && versions.length === 0) return;

    // Time in current phase before switching
    const currentPhase = visualizerPhase();
    const durationSeconds = currentPhase === 'live_art' ? 25 : 30;

    let secondsPassed = 0;
    const interval = window.setInterval(() => {
      // Only advance timer if music is playing
      if (playerStore.playing && !playerStore.loading) {
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
              // Completed all MV clips -> loop back to Live Album Art (or restart MVs if no live art)
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

  // Source selection based on mode:
  const activeSource = () => {
    if (!wanted()) return null;

    // MODE 3: Full YouTube Music Video Mode
    if (isMvMode()) {
      const ytId = ytMvQuery.data?.videoId || (props.track.source === 'yt' ? props.track.id : null);
      if (ytId) return videoStreamUrl(ytId);
      // Fallback to Apple MV or live art if YT MV not ready
      const versions = mvVersions();
      return versions[0]?.url || liveAlbumArtUrl();
    }

    // MODE 2: Visualizer Mode
    if (isVisualizerMode()) {
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
    }

    return null;
  };

  const activeAspect = () => {
    if (isMvMode()) return 16 / 9;
    if (isVisualizerMode()) {
      if (visualizerPhase() === 'live_art') {
        return appleMotionQuery.data?.aspect ?? 1;
      }
      const versions = mvVersions();
      if (versions.length > 0) {
        return versions[currentMvIndex() % versions.length]?.aspect ?? 16 / 9;
      }
    }
    return 1;
  };

  // Video element and playback state
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | null>(null);
  const [ready, setReady] = createSignal(false);
  const [fit, setFit] = createSignal<Fit | null>(null);
  let hlsHandle: ClipHandle | null = null;

  // Mount/attach video source
  createEffect(() => {
    const src = activeSource();
    const el = videoEl();
    setReady(false);
    setFit(null);
    if (!el || !src) return;

    let cancelled = false;
    void attachHlsClip(el, src, { maxBufferLength: 10 }).then((attached) => {
      if (cancelled) attached?.destroy();
      else hlsHandle = attached;
    });

    onCleanup(() => {
      cancelled = true;
      hlsHandle?.destroy();
      hlsHandle = null;
      el.pause();
    });
  });

  // Strict Audio-Video Synchronization
  createEffect(() => {
    const el = videoEl();
    const isWanted = wanted();
    if (!el || !isWanted) return;

    const isAudioPlaying = playerStore.playing && !playerStore.loading;

    // Full MV Mode: Lockstep audio-video sync
    if (isMvMode()) {
      if (isAudioPlaying && el.paused) {
        el.play().catch(() => undefined);
      } else if (!isAudioPlaying && !el.paused) {
        el.pause();
      }

      // Seek sync & drift correction (<0.35s tolerance)
      const curTime = playerStore.currentTime;
      if (Math.abs(el.currentTime - curTime) > 0.35) {
        el.currentTime = curTime;
      }
    } else {
      // Visualizer Mode: Normal play/pause with audio
      if (isAudioPlaying && visible()) {
        el.play().catch(() => undefined);
      } else {
        el.pause();
      }
    }
  });

  // Report aspect ratio and video element to caller (FullScreenPlayer, ArtworkBackdrop)
  createEffect(() => {
    const ratio = activeAspect();
    if (props.onAspect && ratio > 0) props.onAspect(ratio);
  });

  createEffect(() => {
    const el = ready() && activeSource() ? videoEl() : null;
    props.onVideo?.(el);
    onCleanup(() => props.onVideo?.(null));
  });

  // Measure letterbox bars on visualizer clips to eliminate black bars
  createEffect(() => {
    const el = videoEl();
    const isReady = ready();
    if (!isReady || !el || isMvMode()) return;
    const timer = window.setTimeout(() => setFit(detectBars(el)), 600);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <Show when={activeSource()} keyed>
      {(src) => (
        <video
          ref={setVideoEl}
          src={src}
          crossOrigin="anonymous"
          muted
          playsinline
          autoplay
          preload="auto"
          loop={!isMvMode()}
          aria-hidden="true"
          class={`pointer-events-none absolute inset-0 z-10 size-full rounded-[inherit] object-cover transition-opacity duration-700 ease-in-out ${
            ready() && activeSource() ? 'opacity-100' : 'opacity-0'
          }`}
          style={
            fit() && !isMvMode()
              ? { transform: `scale(${fit()!.scale}) translateY(${fit()!.shift}%)` }
              : undefined
          }
          onPlaying={() => setReady(true)}
          onLoadedData={(e) => {
            setReady(true);
            if (playerStore.playing && visible()) e.currentTarget.play().catch(() => undefined);
          }}
          onCanPlay={(e) => {
            setReady(true);
            if (playerStore.playing && visible()) e.currentTarget.play().catch(() => undefined);
          }}
          onError={() => {
            setReady(false);
          }}
        />
      )}
    </Show>
  );
}
