import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { PlayIcon, ShuffleIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { AppleMotionArtwork } from '@/components/music/AppleMotionArtwork';
import { playList, shuffleList } from '@/components/music/play';
import { PrefetchLink } from '@/components/PrefetchLink';
import { pageArtStore } from '@/lib/pageArt';
import { cleanArtistDisplay } from '@/lib/artistCredits';
import type { Track } from '@/lib/types';

const SLIDES = 8;
const SLIDE_MS = 9_000;

/**
 * Times-Square-grade hero: a cinematic rotating stage of the day's biggest songs.
 *
 * Large HD poster with motion artwork, vivid neon accent glow behind the poster,
 * frosted backdrop, and auto-advancing slides. Everything is click-to-play.
 */
export function HomeHero(props: { tracks: Track[] }) {
  const slides = createMemo(() => {
    const seen = new Set<string>();
    return props.tracks.filter((t) => t.thumb && !seen.has(t.id) && seen.add(t.id)).slice(0, SLIDES);
  });
  const [index, setIndex] = createSignal(0);
  const [armed, setArmed] = createSignal(false);
  const [hover, setHover] = createSignal(false);
  const current = () => slides()[Math.min(index(), Math.max(0, slides().length - 1))];

  onMount(() => {
    const idle = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const id = idle.requestIdleCallback ? idle.requestIdleCallback(() => setArmed(true), { timeout: 1800 }) : window.setTimeout(() => setArmed(true), 900);
    onCleanup(() => (idle.cancelIdleCallback ? idle.cancelIdleCallback(id) : window.clearTimeout(id)));
  });

  // The page behind the hero takes the slide's colours.
  createEffect(() => {
    const thumb = current()?.thumb;
    if (!thumb) return;
    pageArtStore.set({ url: thumb, dim: 0.38 });
    onCleanup(() => pageArtStore.set({ url: null }));
  });

  const next = () => setIndex((i) => (i + 1) % Math.max(1, slides().length));
  const artists = (t: Track) =>
    (t.artists || []).map(cleanArtistDisplay).filter(Boolean).join(', ') || cleanArtistDisplay(t.channel || '');

  return (
    <Show when={current()} fallback={<div class="min-h-[clamp(340px,50vh,500px)]" aria-hidden="true" />}>
      <section
        class="hero-stage relative isolate -mt-8 overflow-hidden max-sm:-mt-[var(--mobile-top-bar-height)]"
        aria-roledescription="carousel"
        aria-label="Featured today"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {/* Clean subtle top-to-bottom readability scrim — single AppBackground layer behind it, no double blur */}
        <div class="pointer-events-none absolute inset-0 -z-1 overflow-hidden">
          <div class="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.42)_0%,rgba(0,0,0,0.08)_50%,transparent_100%)]" />
          <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(7,7,8,0.55)]" />
        </div>

        <div class="hero-grid mx-auto grid min-h-[clamp(600px,88vh,880px)] max-w-[1680px] grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-center gap-x-[clamp(24px,4vw,80px)] px-(--body-gutter) pt-28 pb-20 max-lg:grid-cols-1 max-lg:justify-items-start max-lg:gap-y-8 max-lg:pt-24">
          {/* ---- copy ---- */}
          <Show keyed when={current()}>
            {(track) => (
              <div class="order-1 min-w-0 animate-[hero-rise_800ms_80ms_cubic-bezier(0.22,1,0.36,1)_both] max-lg:order-2">
                {/* Rank badge */}
                <p class="mb-5 inline-flex items-center gap-2 rounded-full bg-black/40 px-5 py-2 type-[700_12px/15px] tracking-[0.2em] text-white uppercase [backdrop-filter:blur(18px)_saturate(1.6)] border border-white/12 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                  <span class="size-2 rounded-full bg-white" />
                  No. {index() + 1} today
                </p>
                {/* Song title — cinematic scale */}
                <h2 class="line-clamp-3 type-[800_clamp(44px,7vw,104px)/0.96] tracking-[-0.05em] text-white [text-shadow:0_4px_32px_rgba(0,0,0,0.65)]">
                  {track.title}
                </h2>
                {/* Artist */}
                <p class="mt-4 line-clamp-2 type-[600_clamp(18px,1.8vw,26px)/1.3] text-white/90">{artists(track)}</p>
                {/* CTA buttons — clean Apple style, no outer glow */}
                <div class="mt-9 flex flex-wrap items-center gap-4">
                  <button
                    class="sq-pill inline-flex h-[58px] items-center gap-3 bg-white px-10 type-[700_17px/22px] text-black shadow-[0_12px_30px_-8px_rgba(0,0,0,0.65)] transition-all duration-300 hover:scale-[1.04] hover:bg-white/95 active:scale-95"
                    onClick={() => playList(slides(), index())}
                  >
                    <PlayIcon size={20} fill="currentColor" /> Play
                  </button>
                  <button
                    class="sq-pill inline-flex h-[58px] items-center gap-3 bg-black/45 px-8 type-[650_17px/22px] text-white border border-white/14 shadow-[0_10px_28px_-8px_rgba(0,0,0,0.6)] [backdrop-filter:blur(18px)_saturate(1.6)] transition-all duration-300 hover:bg-white/[0.14] hover:scale-[1.04] hover:border-white/25 active:scale-95"
                    onClick={() => shuffleList(slides())}
                  >
                    <ShuffleIcon size={19} /> Shuffle
                  </button>
                  <Show when={track.albumId}>
                    <PrefetchLink
                      to={`/album/${encodeURIComponent(track.albumId!)}`}
                      class="sq-pill inline-flex h-[58px] items-center bg-black/35 px-7 type-[600_16px/22px] text-white/92 border border-white/12 [backdrop-filter:blur(16px)_saturate(1.5)] transition-all duration-300 hover:bg-white/[0.12] hover:border-white/22"
                    >
                      View album
                    </PrefetchLink>
                  </Show>
                </div>

                {/* Slide thumbnails — crisp square with subtle corner curve */}
                <div class="mt-11 flex items-center gap-3.5 max-sm:hidden">
                  <For each={slides()}>
                    {(slide, i) => (
                      <button
                        class="group/chip relative size-[72px] overflow-hidden rounded-[6px] opacity-55 border border-white/12 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.75)] outline-offset-2 transition-[opacity,transform,border-color] duration-500 hover:scale-105 hover:opacity-100 hover:border-white/30 data-[on]:scale-110 data-[on]:opacity-100 data-[on]:border-white/55"
                        data-on={i() === index() || undefined}
                        aria-label={`Show ${slide.title}`}
                        aria-current={i() === index()}
                        onClick={() => setIndex(i())}
                      >
                        <Artwork src={slide.thumb} track={slide} displayWidth={72} radius="0" class="size-full" />
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>

          {/* ---- poster ---- */}
          <Show keyed when={current()}>
            {(track) => (
              <div class="hero-poster-wrap order-2 relative justify-self-end w-full max-w-[520px] max-lg:order-1 max-lg:justify-self-start max-lg:max-w-[380px] animate-[hero-rise_900ms_cubic-bezier(0.22,1,0.36,1)_both]">
                <div class="hero-poster relative aspect-square w-full overflow-hidden rounded-[10px] shadow-[0_30px_80px_-18px_rgba(0,0,0,0.9),0_12px_28px_-6px_rgba(0,0,0,0.65)] border border-white/14">
                  <Artwork src={track.thumb} track={track} displayWidth={800} radius="10px" eager class="size-full rounded-[10px]" />
                  <div class="absolute inset-0 overflow-hidden rounded-[10px]">
                    <Show when={armed()}>
                      <AppleMotionArtwork track={track} appleOnly />
                    </Show>
                  </div>
                  <div class="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_0_0_0.5px_rgba(255,255,255,0.12)]" />
                </div>
              </div>
            )}
          </Show>
        </div>

        {/* Progress segments */}
        <div class="absolute inset-x-(--body-gutter) bottom-7 z-1 flex gap-2.5 max-sm:bottom-3" role="tablist" aria-label="Slides">
          <For each={slides()}>
            {(slide, i) => (
              <button
                role="tab"
                aria-selected={i() === index()}
                aria-label={slide.title}
                class="h-[4px] flex-1 overflow-hidden rounded-full bg-white/18 backdrop-blur-md [corner-shape:round]"
                onClick={() => setIndex(i())}
              >
                <Show when={i() < index()}>
                  <span class="block h-full w-full bg-white/85" />
                </Show>
                <Show keyed when={i() === index() ? index() + 1 : null}>
                  {(_run) => (
                    <span
                      class="hero-progress block h-full w-full origin-left bg-white"
                      style={{ 'animation-duration': `${SLIDE_MS}ms`, 'animation-play-state': hover() ? 'paused' : 'running' }}
                      onAnimationEnd={next}
                    />
                  )}
                </Show>
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
