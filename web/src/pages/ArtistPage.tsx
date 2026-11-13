/* ArtistPage.tsx — an artist (report §4): full-bleed hero with the name and
 * Play, Top Songs, the catalogue's shelves, the year-wise discography, and
 * About. The page takes the artwork's colour behind it, as Apple's does. */

import { createEffect, createMemo, createSignal, onCleanup, Show, For } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { PlayIcon } from '@/components/icons/Transport';
import { Radio } from 'lucide-solid';
import { CircleLockup, SquareLockup } from '@/components/music/Lockups';
import { ShelfScroller, TrackGridShelf } from '@/components/music/ShelfView';
import { LoadError } from '@/components/music/States';
import { cardItem } from '@/components/music/types';
import { playList } from '@/components/music/play';
import { api } from '@/lib/api';
import { useArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { playerStore } from '@/store/player';
import { ArtistSkeleton } from '@/skeletons/PageSkeletons';
import type { DiscoItem } from '@/lib/types';
import { AppleArtistBanner } from '@/components/music/AppleArtistBanner';
import { MotionFrost } from '@/components/music/MotionFrost';

const FILTERS = ['All', 'Albums', 'Singles'] as const;

/** The discography's segmented control (report §6 tokens). */
function Segmented(props: { value: string; onChange: (v: (typeof FILTERS)[number]) => void }) {
  return (
    <div class="inline-flex items-center gap-0.5 rounded-pill bg-segmented p-0.5" role="tablist" aria-label="Discography filter">
      <For each={FILTERS}>
        {(f) => (
          <button
            role="tab"
            aria-selected={props.value === f}
            class={`rounded-pill px-3 py-1 type-callout-emphasized transition-colors ${
              props.value === f ? 'bg-segmented-selected text-primary shadow-[0_1px_3px_#0000001f]' : 'text-secondary hover:text-primary'
            }`}
            onClick={() => props.onChange(f)}
          >
            {f}
          </button>
        )}
      </For>
    </div>
  );
}

export default function ArtistPage() {
  const params = useParams();
  const id = () => params.id ?? '';

  const query = useQuery(() => ({
    queryKey: ['artist', id()],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.artist(id(), signal),
    staleTime: 12 * 3600_000,
    retry: (failureCount, failure) => failureCount < 1 && !(failure instanceof Error && failure.message === 'HTTP 404'),
    retryDelay: (attempt) => Math.min(700 * 2 ** attempt, 1800),
    enabled: !!id(),
  }));

  const [artistPalette, setArtistPalette] = createSignal<{ artistId: string; artwork: string | null } | null>(null);
  const pagePalette = createMemo(() => artistPalette()?.artistId === id() ? artistPalette() : null);
  const paletteArtwork = createMemo(() => pagePalette()?.artwork ?? query.data?.thumb);
  // Use the exact same sampling/tint path as album pages so the artist
  // background follows the actual artwork, not Apple's separate color hint.
  usePageTint(useArtworkColor(paletteArtwork), paletteArtwork);

  const onArtistPalette = ({ artwork }: { artwork: string | null }) => {
    setArtistPalette({ artistId: id(), artwork });
  };

  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>('All');
  // The playing motion clip, once it is on screen. The whole page frosts a
  // blurred copy of it, and the stills' colour washes step aside.
  const [motionVideo, setMotionVideo] = createSignal<HTMLVideoElement | null>(null);
  let lastArtistId = id();
  createEffect(() => {
    const nextId = id();
    if (!nextId || nextId === lastArtistId) return;
    lastArtistId = nextId;
    setArtistPalette(null);
    setMotionVideo(null);
    setFilter('All');
    const page = document.getElementById('scrollable-page');
    if (page) page.scrollTop = 0;
  });
  createEffect(() => {
    const page = document.getElementById('scrollable-page');
    const video = motionVideo();
    if (!page) return;
    if (video) page.dataset.motion = 'true';
    else delete page.dataset.motion;
    onCleanup(() => {
      delete page.dataset.motion;
    });
  });

  const years = createMemo(() => {
    const disco = (query.data?.discography || []).filter((d: DiscoItem) => {
      if (filter() === 'All') return true;
      const type = (d.type || '').toLowerCase();
      return filter() === 'Albums' ? type.includes('album') : type.includes('single') || type.includes('ep');
    });
    const groups = new Map<string, DiscoItem[]>();
    for (const item of disco) {
      const year = item.year ? String(item.year) : 'Other';
      const list = groups.get(year);
      if (list) list.push(item);
      else groups.set(year, [item]);
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 'Other') return 1;
      if (b[0] === 'Other') return -1;
      return parseInt(b[0], 10) - parseInt(a[0], 10);
    });
  });

  return (
    <Show when={query.data?.id === id() ? query.data : undefined} keyed fallback={<Show when={query.isError} fallback={<ArtistSkeleton />}><LoadError error={query.error} onRetry={() => void query.refetch()} /></Show>}>
      {(artist) => {
        const audience = [artist.listeners ? `${artist.listeners} monthly listeners` : null, artist.subscribers ? `${artist.subscribers} subscribers` : null]
          .filter(Boolean)
          .join(' · ');

        const smallButton =
          'grid size-9 place-items-center rounded-full text-white transition-[background-color,scale] duration-200 hover:scale-105';

        return (
          <div class="relative">
            {/* The frosted page: a blurred, darkened copy of the motion clip that
                stays put while the page scrolls over it. */}
            <Show when={motionVideo()}>
              <div class="pointer-events-none sticky top-0 z-0 -mb-[100dvh] -ml-(--web-navigation-width) h-dvh animate-[fade-in_1.6s_ease_both] max-sm:ml-0">
                <MotionFrost video={motionVideo()!} />
              </div>
            </Show>

            <div class="relative z-[1]">
              {/* The hero: big, the whole motion in view, the name pinned bottom-left. */}
              <div class="relative -mt-8 max-sm:-mt-[var(--mobile-top-bar-height)]">
              <AppleArtistBanner name={artist.name} thumb={artist.thumb} onMotionVideo={setMotionVideo} onPalette={onArtistPalette} />
              </div>

              {artist.topSongs.length > 0 && (
                <div class="artist-rise -mt-4 max-sm:mt-0" style={{ '--i': 0 }}>
                <TrackGridShelf
                  title="Top Songs"
                  emphasized
                  tracks={artist.topSongs}
                  headerExtra={
                    <div class="flex min-w-0 items-center gap-2.5 font-normal">
                      <button
                        class={`${smallButton} bg-key-bg shadow-[0_2px_8px_-2px_#0008,inset_0_0_2px_#ffffff26]`}
                        aria-label={`Play ${artist.name}`}
                        onClick={() => playList(artist.topSongs, 0)}
                      >
                        <PlayIcon size={16} />
                      </button>
                      {artist.radioId && (
                        <button
                          class={`${smallButton} bg-white/12 [backdrop-filter:blur(20px)_saturate(1.6)] hover:bg-white/20`}
                          aria-label={`Start ${artist.name} radio`}
                          title="Start radio"
                          onClick={() => void playerStore.startRadio(artist.topSongs[0]!)}
                        >
                          <Radio size={16} strokeWidth={2} />
                        </button>
                      )}
                      {audience && <span class="truncate type-callout text-secondary">{audience}</span>}
                    </div>
                  }
                />
                </div>
              )}

              {(artist.sections || []).map((section, sectionIndex) =>
                section.items?.length ? (
                  <section class="artist-rise pt-9" style={{ '--i': sectionIndex + 1 }} aria-label={section.title}>
                    <div class="mx-(--body-gutter) mb-3.5 flex min-h-[22px] items-center type-title-2-emphasized">
                      <h2>{section.title}</h2>
                    </div>
                    <ShelfScroller kind="square">
                      <For each={section.items}>
                        {(item) => (
                          <li>
                            <SquareLockup item={cardItem(item)} />
                          </li>
                        )}
                      </For>
                    </ShelfScroller>
                  </section>
                ) : null,
              )}

              {years().length > 0 && (
                <section class="artist-rise pt-9" style={{ '--i': (artist.sections || []).length + 1 }} aria-label="Discography">
                  <div class="mx-(--body-gutter) mb-3.5 flex min-h-[28px] flex-wrap items-center justify-between gap-2">
                    <h2 class="type-title-2-emphasized">Discography</h2>
                    <Segmented value={filter()} onChange={setFilter} />
                  </div>
                  <For each={years()}>
                    {([year, items]) => (
                      <div class="mb-6">
                        <h3 class="disco-year mx-(--body-gutter) mb-2 type-title-3-emphasized text-secondary">{year}</h3>
                        <ShelfScroller kind="square">
                          <For each={items}>
                            {(item) => (
                              <li>
                                <SquareLockup item={cardItem(item)} />
                              </li>
                            )}
                          </For>
                        </ShelfScroller>
                      </div>
                    )}
                  </For>
                </section>
              )}

              {artist.description && (
                <section class="artist-rise mx-(--body-gutter) mt-3 mb-10" style={{ '--i': (artist.sections || []).length + 2 }} aria-label={`About ${artist.name}`}>
                  <h2 class="type-title-2-emphasized">About {artist.name}</h2>
                  <p class="mt-2 max-w-[720px] type-body-tall whitespace-pre-line text-secondary">{artist.description}</p>
                </section>
              )}

              {(artist.similar || []).length > 0 && (
                <section class="artist-rise artist-recommendations pt-9" style={{ '--i': (artist.sections || []).length + 3 }} aria-label="Similar Artists">
                  <div class="mx-(--body-gutter) mb-3.5 flex min-h-[22px] items-center type-title-2-emphasized">
                    <h2>Similar Artists</h2>
                  </div>
                  <ShelfScroller kind="circle">
                    <For each={artist.similar || []}>
                      {(item, i) => (
                        <li class="artist-recommendation" style={{ 'animation-delay': `${Math.min(i(), 8) * 45}ms` }}>
                          <CircleLockup item={{ ...cardItem(item), kind: 'artist' }} />
                        </li>
                      )}
                    </For>
                  </ShelfScroller>
                </section>
              )}
            </div>
          </div>
        );
      }}
    </Show>
  );
}
