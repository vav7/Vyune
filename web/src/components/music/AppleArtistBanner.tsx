/* AppleArtistBanner.tsx — Apple's own artist banner, made big.
 *
 * What an Apple Music artist page wears: a wide hero that fills the top of the
 * page, the artist's title logo typeset over it, and for many artists a
 * looping 16:9 motion clip that stands in for the still.
 *
 * The motion is shown whole: the band keeps the clip's own 16:9 shape (capped
 * to the screen's height), the name or logo stays pinned at the bottom-left
 * above the video, and the bottom edge dissolves into the page. When the clip
 * is playing it is also handed to the page (`onMotionVideo`), which frosts a
 * blurred copy of it behind everything — the old stills and their colour
 * washes are dropped the moment it is on screen.
 *
 * Fallback order when Apple has less: wide still → the clip's preview frame →
 * the YouTube Music artist picture.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show, For } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { api, proxiedImg } from '@/lib/api';
import { attachHlsClip, type ClipHandle } from '@/lib/hlsClip';
import { useTier } from '@/lib/perf';
import type { AppleArtistArt } from '@/lib/types';

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function useReducedMotion() {
  const [reduced, setReduced] = createSignal(reducedMotion?.matches ?? false);
  const listener = () => setReduced(reducedMotion?.matches ?? false);
  reducedMotion?.addEventListener('change', listener);
  onCleanup(() => reducedMotion?.removeEventListener('change', listener));
  return reduced;
}

/** The tab being in front is all the clip needs: it also feeds the page's frosted background. */
function useTabVisible() {
  const [visible, setVisible] = createSignal(document.visibilityState === 'visible');
  const listener = () => setVisible(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', listener);
  onCleanup(() => document.removeEventListener('visibilitychange', listener));
  return visible;
}

function useMotionClip(source: () => string | null | undefined, active: () => boolean) {
  let handle: ClipHandle | null = null;

  const [element, setElement] = createSignal<HTMLVideoElement | null>(null);

  createEffect(() => {
    const src = source();
    const el = element();
    if (!el || !src) return;
    let cancelled = false;
    void attachHlsClip(el, src, { maxBufferLength: 12 }).then((attached) => {
      if (cancelled) attached?.destroy();
      else handle = attached;
    });
    onCleanup(() => {
      cancelled = true;
      handle?.destroy();
      handle = null;
    });
  });

  createEffect(() => {
    const src = source();
    const el = element();
    if (!el || !src) return;
    if (!active()) {
      el.pause();
      return;
    }
    const play = () => {
      const attempt = el.play();
      if (attempt) attempt.catch(() => undefined);
    };
    play();
    el.addEventListener('loadeddata', play);
    onCleanup(() => el.removeEventListener('loadeddata', play));
  });

  return { element, setElement };
}

interface BannerProps {
  name: string;
  /** The YouTube Music artist picture: the fallback banner. */
  thumb?: string | null;
  /** Called with the playing clip once it is on screen, and null when it goes. */
  onMotionVideo?: (video: HTMLVideoElement | null) => void;
  /** The artwork the page's colour should follow while no motion is playing. */
  onPalette?: (palette: { artwork: string | null }) => void;
}

const ART_KEY = 'mc_apple_art_v1:';
function readStoredArt(name: string): { art: AppleArtistArt; at: number } | null {
  try {
    const raw = localStorage.getItem(ART_KEY + name.toLowerCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { art: AppleArtistArt; at: number };
    return Date.now() - parsed.at < 24 * 3600_000 && parsed.art && !parsed.art.transient ? parsed : null;
  } catch {
    return null;
  }
}
function writeStoredArt(name: string, art: AppleArtistArt) {
  try {
    if (art && !art.transient) localStorage.setItem(ART_KEY + name.toLowerCase(), JSON.stringify({ art, at: Date.now() }));
  } catch {
    /* storage can be full or unavailable */
  }
}

export function AppleArtistBanner({ name, thumb, onMotionVideo, onPalette }: BannerProps) {
  const reduced = useReducedMotion();
  const tier = useTier();
  const still = () => reduced() || !tier.motion;
  const tabVisible = useTabVisible();
  // A repeat visit starts from what the last one found (kept on this device for a day),
  // so the banner and its clip are asked for at once instead of after a round trip.
  const stored = createMemo(() => readStoredArt(name));
  const query = useQuery(() => ({
    queryKey: ['apple-art', name],
    queryFn: async () => {
      const fresh = await api.appleArtist(name);
      writeStoredArt(name, fresh);
      return fresh;
    },
    initialData: () => stored()?.art,
    initialDataUpdatedAt: () => stored()?.at,
    staleTime: (query) => (query.state.data?.transient ? 0 : 24 * 3600_000),
    refetchInterval: (query) => (query.state.data?.transient ? 5_000 : false),
    refetchIntervalInBackground: false,
    retry: false,
    enabled: !!name,
  }));

  const art = () => query.data;
  const wideClip = () => !!art()?.wideMotion;
  const motionSource = () => art()?.wideMotion ?? art()?.motion ?? null;
  const clip = useMotionClip(() => still() ? null : motionSource(), () => tabVisible() && !still());
  const video = clip.element;
  const [motionReady, setMotionReady] = createSignal(false);
  const [stillsGone, setStillsGone] = createSignal(false);

  createEffect(() => {
    motionSource();
    still();
    setMotionReady(false);
    setStillsGone(false);
  });

  // Once the clip is truly playing, the stills have done their job: let the
  // crossfade finish, then stop drawing them at all.
  createEffect(() => {
    if (!motionReady()) return;
    const timer = window.setTimeout(() => setStillsGone(true), 1600);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    onMotionVideo?.(motionReady() && video() ? video() : null);
    onCleanup(() => onMotionVideo?.(null));
  });

  // More HD pictures for the slideshow, asked for only when Apple has no clip.
  // Asked for right away, in parallel with Apple (the server keeps it for 12 hours): the slideshow never waits.
  const wantsExtras = () => !still();
  const extraQuery = useQuery(() => ({
    queryKey: ['artist-images', name],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.artistImages(name, signal),
    staleTime: 12 * 3600_000,
    retry: false,
    enabled: !!name && wantsExtras(),
  }));

  const wideSource = () => {
    const value = art();
    const banner = value?.banner || value?.wide || null;
    const aspect = value?.bannerAspect || value?.wideAspect || 0;
    // Apple sometimes labels a square artist portrait as both "banner" and
    // "wide". Prefer the actual landscape motion frame when it happens.
    return banner && aspect >= 1.35 ? banner : value?.widePreview || value?.preview || banner;
  };
  const hasWide = () => !!wideSource();
  const allStills = () => {
    const ws = wideSource();
    const arr = [
      ws,
      thumb || null,
      art()?.widePreview && art()?.widePreview !== ws ? art()?.widePreview : null,
      art()?.preview && art()?.preview !== ws ? art()?.preview : null,
      ...(extraQuery.data?.images ?? []),
      !hasWide() && !thumb ? (art()?.square || art()?.hero || null) : null,
    ].filter((src): src is string => !!src);
    return [...new Set(arr)].slice(0, 6);
  };
  // With a clip on the way there is one still — the one it grows out of — and
  // it never changes, so neither the picture nor the page's colour wanders.
  const slideSources = () => (motionSource() && !still() ? allStills().slice(0, 1) : allStills());
  const slides = () => slideSources().map(proxiedImg);
  const [activeSlide, setActiveSlide] = createSignal(0);
  const [previousSlide, setPreviousSlide] = createSignal<number | null>(null);

  // A slow slideshow: each picture stays about 10 seconds and melts into the
  // next over 3.5. The picture that is leaving stays fully opaque underneath
  // until the new one has arrived, so the page never dips towards black.
  createEffect(() => {
    setActiveSlide(0);
    setPreviousSlide(null);
    if (still() || slides().length < 2) return;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => {
        setPreviousSlide(current);
        return (current + 1) % slides().length;
      });
    }, 10_000);
    onCleanup(() => window.clearInterval(timer));
  });

  const background = () => art()?.background ?? null;
  const paletteSource = () => {
    const ss = slideSources();
    return ss[Math.min(activeSlide(), Math.max(0, ss.length - 1))] || wideSource() || thumb || null;
  };
  createEffect(() => {
    onPalette?.({ artwork: paletteSource() });
  });

  const posterSource = () => art()?.widePreview || art()?.preview || wideSource();
  const poster = () => posterSource() ? proxiedImg(posterSource()!) : null;
  const logo = () => art()?.logo ? proxiedImg(art()!.logo!) : null;
  const displayName = () => art()?.name || name;

  return (
    <header
      class="relative"
      data-apple-banner={art() ? true : undefined}
    >
      {/* The band keeps the clip's own 16:9 so the whole motion is on screen;
          its bottom edge melts into the page (and into the frosted copy of the
          clip behind it). */}
      <div
        class="relative w-full overflow-hidden [mask-image:linear-gradient(180deg,#000_0%,#000_56%,rgba(0,0,0,0.82)_68%,rgba(0,0,0,0.52)_80%,rgba(0,0,0,0.2)_91%,transparent_100%)]"
        style={{ 'aspect-ratio': '16 / 9', 'min-height': 'clamp(340px, 52vh, 560px)', 'max-height': '88dvh' }}
      >
        <div class="absolute inset-0 hero-settle">
        <Show when={!stillsGone()}>
          <For each={slides()}>
            {(src, index) => (
              <div
                // The arriving slide fades in on top; the leaving one holds at full opacity below it, then is dropped.
                class={`absolute inset-0 ${
                  index() === activeSlide()
                    ? `${previousSlide() === null ? 'animate-[slide-in_900ms_ease-out_both]' : 'animate-[slide-in_3500ms_ease-in-out_both]'} z-[2]`
                    : index() === previousSlide()
                    ? 'z-[1] opacity-100 transition-none'
                    : 'z-0 opacity-0 transition-none'
                }`}
                aria-hidden="true"
              >
                <img
                  src={src}
                  alt=""
                  referrerPolicy="no-referrer"
                  decoding="async"
                  fetchpriority={index() === 0 ? 'high' : 'auto'}
                  class={`absolute inset-0 size-full ${hasWide() ? 'object-cover object-[center_30%]' : 'object-contain object-center'} ${!motionSource() ? 'motion-safe:animate-artist-drift' : ''}`}
                />
              </div>
            )}
          </For>
        </Show>

        <Show when={motionSource() && !still()}>
          <video
            ref={clip.setElement}
            poster={poster() ?? undefined}
            muted
            loop
            playsinline
            autoplay
            preload="auto"
            aria-hidden="true"
            class={`absolute inset-0 z-[3] size-full ${wideClip() ? 'object-cover object-[center_30%]' : 'object-contain object-center'} transition-opacity duration-[1400ms] ease-in-out ${motionReady() ? 'opacity-100' : 'opacity-0'}`}
            onPlaying={() => setMotionReady(true)}
            onCanPlay={(e) => {
              if (tabVisible() && !still()) e.currentTarget.play().catch(() => undefined);
            }}
            onError={() => setMotionReady(false)}
          />
        </Show>
        </div>

        {/* A soft scrim, only where the name sits. */}
        <div
          class="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(0,0,0,0.30)_0%,transparent_26%,transparent_52%,rgba(0,0,0,0.66)_100%)]"
          aria-hidden="true"
        />
      </div>

      {/* The name — or Apple's own typeset logo — pinned bottom-left, above the video. */}
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-[4] flex items-end px-(--body-gutter) pb-7 text-left max-sm:pb-5 hero-name">
        <Show when={logo()}>
          {(logoSrc) => (
            <img
              src={logoSrc()}
              alt={displayName()}
              referrerPolicy="no-referrer"
              decoding="async"
              class="max-h-[clamp(60px,9.5vw,148px)] max-w-[min(72%,720px)] object-contain object-left [filter:drop-shadow(0_4px_22px_rgba(0,0,0,0.6))]"
              style={art()?.logoAspect ? { 'aspect-ratio': String(art()!.logoAspect!) } : undefined}
            />
          )}
        </Show>
        <Show when={!logo()}>
          <h1 class="text-[clamp(40px,7vw,104px)] leading-[0.98] font-bold tracking-[-0.035em] text-white [text-shadow:0_4px_28px_#00000099]">
            {displayName()}
          </h1>
        </Show>
      </div>

      <Show when={background()}>
        <style>{`[data-apple-banner]{--apple-art-bg:${background()}}`}</style>
      </Show>
    </header>
  );
}
