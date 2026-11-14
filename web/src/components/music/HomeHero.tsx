import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { PlayIcon, ShuffleIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { AppleMotionArtwork } from '@/components/music/AppleMotionArtwork';
import { ImageFrost } from '@/components/music/ImageFrost';
import { MotionFrost } from '@/components/music/MotionFrost';
import { playList, shuffleList } from '@/components/music/play';
import { PrefetchLink } from '@/components/PrefetchLink';
import { pageArtStore } from '@/lib/pageArt';
import type { Track } from '@/lib/types';

const SLIDES = 6;
const SLIDE_MS = 11_000;

/**
 * The front page's feature: a rotating stage of the day's biggest songs.
 *
 * The poster is a large HD squircle whose artwork comes alive (Apple's motion sleeve where the
 * catalogue has one). The *same* playing clip is frosted by the GPU behind the whole hero, and the
 * page behind it takes the artwork's colours, so the light in the room changes with every slide.
 * Slides advance on a CSS progress bar, which pauses while the pointer is over the hero.
 */
export function HomeHero(props: { tracks: Track[] }) {
  const slides = createMemo(() => {
    const seen = new Set<string>();
    return props.tracks.filter((t) => t.thumb && !seen.has(t.id) && seen.add(t.id)).slice(0, SLIDES);
  });
  const [index, setIndex] = createSignal(0);
  const [video, setVideo] = createSignal<HTMLVideoElement | null>(null);
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
    pageArtStore.set({ url: thumb, dim: 0.5 });
    onCleanup(() => pageArtStore.set({ url: null }));
  });

  const next = () => setIndex((i) => (i + 1) % Math.max(1, slides().length));
  const artists = (t: Track) => (t.artists || []).join(', ');

  return (
    <Show when={current()} fallback={<div class="min-h-[clamp(340px,50vh,500px)]" aria-hidden="true" />}>
      <section
        class="hero-stage relative isolate -mt-8 overflow-hidden max-sm:-mt-[var(--mobile-top-bar-height)]"
        aria-roledescription="carousel"
        aria-label="Featured today"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {/* The music video / motion sleeve, frosted: the hero's own light. */}
        <div class="pointer-events-none absolute inset-0 -z-1 overflow-hidden">
          <Show when={video()} fallback={<ImageFrost src={current()!.thumb} dim={0.46} />}>
            <MotionFrost video={video()} dim={0.4} />
          </Show>
          <div class="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,4,8,0.62)_0%,rgba(4,4,8,0.18)_52%,transparent_100%)]" />
          <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--pageBG,#07070b)]" />
        </div>

        <div class="hero-grid mx-auto grid min-h-[clamp(560px,82vh,800px)] max-w-[1680px] grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-center gap-x-[clamp(24px,4vw,80px)] px-(--body-gutter) pt-28 pb-16 max-lg:grid-cols-1 max-lg:justify-items-start max-lg:gap-y-8 max-lg:pt-24">
          {/* ---- copy ---- */}
          <Show keyed when={current()}>
            {(track) => (
              <div class="order-1 min-w-0 animate-[hero-rise_800ms_80ms_cubic-bezier(0.22,1,0.36,1)_both] max-lg:order-2">
                <p class="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.12] px-3.5 py-1.5 type-[700_11px/14px] tracking-[0.18em] text-white uppercase [backdrop-filter:blur(24px)_saturate(1.6)] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.55)]">
                  <span class="size-1.5 rounded-full bg-white shadow-[0_0_10px_#fff]" />
                  No. {index() + 1} today
                </p>
                <h2 class="line-clamp-3 type-[800_clamp(40px,6.4vw,96px)/0.98] tracking-[-0.045em] text-white [text-shadow:0_2px_40px_rgb(0_0_0/0.35)]">
                  {track.title}
                </h2>
                <p class="mt-4 line-clamp-2 type-[600_clamp(17px,1.7vw,24px)/1.3] text-white/80">{artists(track)}</p>
                <div class="mt-8 flex flex-wrap items-center gap-3">
                  <button
                    class="glow-ring sq-pill inline-flex h-[54px] items-center gap-2.5 bg-white px-8 type-[700_16px/20px] text-black shadow-[0_14px_40px_-12px_rgb(255_255_255/0.55)] transition-[transform,box-shadow] duration-300 hover:scale-[1.04] active:scale-95"
                    onClick={() => playList(slides(), index())}
                  >
                    <PlayIcon size={19} fill="currentColor" /> Play
                  </button>
                  <button
                    class="sq-pill inline-flex h-[54px] items-center gap-2.5 bg-white/[0.14] px-7 type-[650_16px/20px] text-white shadow-[inset_0_0.5px_0_rgb(255_255_255/0.5)] [backdrop-filter:blur(30px)_saturate(1.7)] transition-[transform,background-color] duration-300 hover:bg-white/[0.22] active:scale-95"
                    onClick={() => shuffleList(slides())}
                  >
                    <ShuffleIcon size={18} /> Shuffle
                  </button>
                  <Show when={track.albumId}>
                    <PrefetchLink
                      to={`/album/${encodeURIComponent(track.albumId!)}`}
                      class="sq-pill inline-flex h-[54px] items-center bg-white/[0.08] px-6 type-[600_15px/20px] text-white/90 [backdrop-filter:blur(30px)] transition-colors hover:bg-white/[0.18]"
                    >
                      View album
                    </PrefetchLink>
                  </Show>
                </div>

                {/* Up next: tap any to jump. */}
                <div class="mt-10 flex items-center gap-3 max-sm:hidden">
                  <For each={slides()}>
                    {(slide, i) => (
                      <button
                        class="group/chip relative size-[68px] overflow-hidden rounded-[22px] [corner-shape:squircle] opacity-60 shadow-[0_10px_30px_-10px_#000] outline-offset-2 transition-[opacity,transform] duration-500 hover:scale-105 hover:opacity-100 data-[on]:scale-110 data-[on]:opacity-100 data-[on]:outline-2 data-[on]:outline-white/80"
                        data-on={i() === index() || undefined}
                        aria-label={`Show ${slide.title}`}
                        aria-current={i() === index()}
                        onClick={() => setIndex(i())}
                      >
                        <Artwork src={slide.thumb} track={slide} displayWidth={68} radius="0" class="size-full" />
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
              <div class="hero-poster-wrap order-2 relative justify-self-end w-full max-w-[480px] max-lg:order-1 max-lg:justify-self-start max-lg:max-w-[360px] animate-[hero-rise_900ms_cubic-bezier(0.22,1,0.36,1)_both]">
                {/* the poster's own glow */}
                <div class="pointer-events-none absolute -inset-6 -z-1 opacity-60 [filter:blur(48px)_saturate(1.8)] [transform:translateZ(0)]" aria-hidden="true">
                  <Artwork src={track.thumb} track={track} displayWidth={120} radius="14px" class="size-full rounded-[14px]" />
                </div>
                <div class="hero-poster relative aspect-square w-full overflow-hidden rounded-[14px] shadow-[0_32px_80px_-20px_rgb(0_0_0/0.85),0_0_0_0.5px_rgb(255_255_255/0.22)]">
                  <Artwork src={track.thumb} track={track} displayWidth={560} radius="14px" eager class="size-full rounded-[14px]" />
                  <div class="absolute inset-0 overflow-hidden rounded-[14px]">
                    <Show when={armed()}>
                      <AppleMotionArtwork track={track} mode="motion" onVideo={setVideo} />
                    </Show>
                  </div>
                  <div class="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_1px_0_rgb(255_255_255/0.4),inset_0_0_0_0.5px_rgb(255_255_255/0.2)]" />
                </div>
              </div>
            )}
          </Show>
        </div>

        {/* progress: one segment per slide, the active one fills over the slide's time */}
        <div class="absolute inset-x-(--body-gutter) bottom-6 z-1 flex gap-2 max-sm:bottom-3" role="tablist" aria-label="Slides">
          <For each={slides()}>
            {(slide, i) => (
              <button
                role="tab"
                aria-selected={i() === index()}
                aria-label={slide.title}
                class="h-[5px] flex-1 overflow-hidden rounded-full bg-white/25 [corner-shape:round]"
                onClick={() => setIndex(i())}
              >
                <Show when={i() < index()}>
                  <span class="block h-full w-full bg-white/90" />
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
