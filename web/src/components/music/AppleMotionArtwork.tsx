import { createEffect, createSignal, onCleanup, Show, type Accessor } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { type ArtMode } from '@/store/artMode';
import type { Track } from '@/lib/types';
import { api } from '@/lib/api';
import { attachHlsClip, type ClipHandle } from '@/lib/hlsClip';
import { useTier } from '@/lib/perf';

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

/** One clip: attached when it has a source, played (looped) while the tab is in front. */
function useClip(source: Accessor<string | null>, active: Accessor<boolean>, loop?: Accessor<boolean>) {
  const [element, setElement] = createSignal<HTMLVideoElement | null>(null);
  const [ready, setReady] = createSignal(false);
  const [fit, setFit] = createSignal<Fit | null>(null);
  let handle: ClipHandle | null = null;

  createEffect(() => {
    const src = source();
    const el = element();
    setReady(false);
    setFit(null);
    if (!el || !src) return;
    let cancelled = false;
    void attachHlsClip(el, src, { maxBufferLength: 8 }).then((attached) => {
      if (cancelled) attached?.destroy();
      else handle = attached;
    });
    onCleanup(() => {
      cancelled = true;
      handle?.destroy();
      handle = null;
      el.pause();
    });
  });

  createEffect(() => {
    const el = element();
    const src = source();
    if (!el || !src) return;
    if (!active()) {
      el.pause();
      return;
    }
    el.play().catch(() => undefined);
  });

  // A plain loop when single clip; multiple MVs advance consecutively onEnded.
  createEffect(() => {
    const el = element();
    const shouldLoop = loop ? loop() : true;
    if (el) el.loop = shouldLoop;
  });

  // Once frames are showing, measure any black bars baked into the clip.
  createEffect(() => {
    const el = element();
    const isReady = ready();
    if (!isReady || !el) return;
    const timer = window.setTimeout(() => setFit(detectBars(el)), 700);
    onCleanup(() => window.clearTimeout(timer));
  });

  return { element, setElement, ready, setReady, fit };
}

/**
 * The song's moving picture, by mode:
 *   static — nothing moves · motion — Apple's square motion artwork · mv — the music video.
 * Each mode asks for its own clip first and settles for the other. The clip keeps its own
 * aspect ratio (reported through `onAspect`), its letterbox bars are cropped away, and it
 * loops.
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

  const mode = () => props.mode ?? 'motion';
  const wanted = () => !reduceMotion() && mode() !== 'static' && (tier.motion || mode() === 'mv');

  const query = useQuery(() => ({
    queryKey: [
      'apple-motion-v2',
      props.track.id,
      props.track.title,
      (props.track.artists || []).join('|'),
      props.track.album,
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.appleMotion(props.track, signal),
    enabled: wanted() && !!props.track.title && !!props.track.artists?.[0],
    staleTime: 24 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
    retry: 1,
    retryDelay: 800,
  }));

  const motionSource = () => query.data?.url || null;
  // Every music video except the lyric video, in the order found. There is nothing to choose: they
  // simply play one after another, and the last hands back to the first.
  const isLyricVideo = (v: { label?: string | null; title?: string | null }) => /lyric/i.test(`${v.label ?? ''} ${v.title ?? ''}`);
  const mvList = () => {
    const all = query.data?.mvs?.length ? query.data.mvs : query.data?.mv ? [query.data.mv] : [];
    const seen = new Set<string>();
    return all.filter((v) => v?.url && !isLyricVideo(v as any) && !seen.has(v.url) && seen.add(v.url));
  };
  const [mvIndex, setMvIndex] = createSignal(0);
  createEffect(() => {
    // a new song starts its videos from the first
    props.track.id;
    setMvIndex(0);
  });
  const chosenMv = () => {
    const list = mvList();
    return list.length ? list[mvIndex() % list.length]! : null;
  };
  const nextMv = () => {
    if (mvList().length > 1) setMvIndex((i) => (i + 1) % mvList().length);
  };

  const mvSource = () => chosenMv()?.url || null;
  const usingMv = () => !!mvSource() && (mode() === 'mv' || !motionSource());
  const wantedSource = () => (!wanted() ? null : usingMv() ? mvSource() : motionSource() || mvSource());

  // Leaving a mode: keep the last clip mounted while it fades out, so the change is a dissolve, not a cut.
  const [source, setSource] = createSignal<string | null>(wantedSource());
  createEffect(() => {
    const wanted_ = wantedSource();
    if (wanted_) {
      setSource(wanted_);
      return;
    }
    const timer = window.setTimeout(() => setSource(null), 900);
    onCleanup(() => window.clearTimeout(timer));
  });

  const isLooped = () => !usingMv() || mvList().length < 2;
  const clip = useClip(source, () => visible() && wanted(), isLooped);
  const aspect = () => (usingMv() ? chosenMv()?.aspect ?? 16 / 9 : query.data?.aspect ?? 1);

  createEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    onCleanup(() => document.removeEventListener('visibilitychange', update));
  });

  createEffect(() => {
    const src = source();
    const ratio = aspect();
    if (src && props.onAspect && ratio > 0) props.onAspect(ratio);
  });

  const playing = () => (clip.ready() && wantedSource() ? clip.element() : null);
  createEffect(() => {
    const video = playing();
    props.onVideo?.(video);
    onCleanup(() => props.onVideo?.(null));
  });

  return (
    <Show when={source()} keyed>
      {(src) => (
        <video
          ref={clip.setElement}
          src={src}
          crossOrigin="anonymous"
          muted
          playsinline
          autoplay
          preload="auto"
          loop={isLooped()}
          onEnded={() => {
            if (usingMv() && mvList().length > 1) {
              nextMv();
            }
          }}
          aria-hidden="true"
          class={`pointer-events-none absolute inset-0 z-10 size-full rounded-[inherit] object-cover transition-opacity duration-[800ms] ease-in-out ${clip.ready() && wantedSource() ? 'opacity-100' : 'opacity-0'}`}
          style={clip.fit() ? { transform: `scale(${clip.fit()!.scale}) translateY(${clip.fit()!.shift}%)` } : undefined}
          onPlaying={() => clip.setReady(true)}
          onCanPlay={(event) => {
            if (visible()) event.currentTarget.play().catch(() => undefined);
          }}
          onError={() => {
            clip.setReady(false);
            if (usingMv() && mvList().length > 1) nextMv();
          }}
        />
      )}
    </Show>
  );
}
