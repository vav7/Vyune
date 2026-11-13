/* BrowsePage.tsx — charts and every mood & genre category (report §6). */

import { createMemo, Show, For } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { PageHeader } from '@/components/PageHeader';
import { CategoryTiles } from '@/components/music/CategoryTiles';
import { Shelves, TrackShelf } from '@/components/music/ShelfView';
import { LoadError } from '@/components/music/States';
import { cardItem } from '@/components/music/types';
import { api } from '@/lib/api';
import { ShelfSkeleton } from '@/skeletons/ShelfSkeleton';

export default function BrowsePage() {
  const charts = useQuery(() => ({ queryKey: ['charts'], queryFn: () => api.charts(), staleTime: 6 * 3600_000 }));
  const genres = useQuery(() => ({ queryKey: ['genres'], queryFn: () => api.genres(), staleTime: 24 * 3600_000 }));

  if (charts.isError && genres.isError) return <LoadError error={charts.error ?? genres.error} onRetry={() => void charts.refetch()} />;

  const shelves = createMemo(() =>
    (charts.data?.items || []).length
      ? [{ title: 'Official Charts', layout: 'square' as const, items: (charts.data?.items || []).map(cardItem) }]
      : [],
  );

  return (
    <>
      <PageHeader title="Browse" />
      {charts.isPending && <ShelfSkeleton kind="tracks" />}
      <Show when={(charts.data?.tracks?.length ?? 0) > 0}>
        <TrackShelf title="Trending Tracks" tracks={charts.data!.tracks} />
      </Show>
      <Shelves shelves={shelves()} />
      <Show when={genres.isPending}>
        <div class="mx-(--body-gutter) mt-[46px] mb-8 grid grid-cols-4 gap-5" aria-busy="true">
          <For each={Array.from({ length: 8 }, (_, i) => i)}>
            {() => <div class="aspect-video rounded-artwork-lg bg-skeleton" />}
          </For>
        </div>
      </Show>
      <Show when={(genres.data?.categories?.length ?? 0) > 0}>
        <CategoryTiles categories={genres.data!.categories} title="All Moods & Genres" />
      </Show>
    </>
  );
}
