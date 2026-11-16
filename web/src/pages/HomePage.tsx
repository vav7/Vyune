/* HomePage.tsx — a rotating hero of the day's biggest songs (live poster, frosted video behind it),
 * four rows of YouTube Music's own playlists, then Recently Played, the charts and the categories. */

import { createMemo, onCleanup, onMount } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { HomeHero } from '@/components/music/HomeHero';
import { Shelves, TrackShelf } from '@/components/music/ShelfView';
import { cardItem } from '@/components/music/types';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { setNavHint } from '@/lib/navHint';
import { prewarmArtworkColor } from '@/lib/artworkColor';

export default function HomePage() {
  // The hero's own wash is the page's light; the shell behind it is the app background.
  onMount(() => {
    const page = document.getElementById('scrollable-page');
    if (!page) return;
    page.dataset.home = 'true';
    onCleanup(() => {
      delete page.dataset.home;
    });
  });

  // One request for the whole page (charts, global top, genres, curated rows). It also seeds the per-section
  // query keys the Browse page reads, so opening Browse next is instant. Persisted: a repeat visit paints from it.
  const home = useQuery(() => ({
    queryKey: ['home'],
    queryFn: async () => {
      const data = await api.home();
      queryClient.setQueryData(['charts'], data.charts);
      queryClient.setQueryData(['genres'], data.genres);
      for (const row of data.curated?.rows || []) {
        for (const item of row.items || []) {
          if (item?.id && item?.title) {
            setNavHint('playlist', item.id, {
              title: item.title,
              thumb: item.thumb,
              subtitle: item.subtitle,
            });
            if (item.thumb) prewarmArtworkColor(item.thumb);
          }
        }
      }
      return data;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  }));
  const charts = () => home.data?.charts;
  const globalTracks = () => home.data?.global?.tracks || [];

  // YouTube Music's own playlists, in four themed rows. The server groups and de-duplicates them.
  const curated = createMemo(() =>
    (home.data?.curated?.rows || []).map((row) => ({
      title: row.title,
      detail: row.detail,
      layout: 'square' as const,
      className: 'curated-row',
      items: row.items.map(cardItem),
    })),
  );

  // InnerTube sometimes repeats the same playlist with variant IDs/titles in
  // adjacent chart shelves. Keep the first catalogue card for each release.
  const chartPlaylists = createMemo(() => {
    const playlistSeen = new Set<string>();
    return (charts()?.items || []).filter((item) => {
      const titleKey = item.title.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
      const key = item.id || titleKey;
      const titleDuplicate = titleKey && playlistSeen.has(`title:${titleKey}`);
      if (!key || playlistSeen.has(key) || titleDuplicate) return false;
      playlistSeen.add(key);
      if (titleKey) playlistSeen.add(`title:${titleKey}`);
      return true;
    });
  });

  const shelves = createMemo(() =>
    !home.isPending && curated().length === 0 && chartPlaylists().length
      ? [
          {
            title: 'Chart Playlists',
            layout: 'square' as const,
            seeAll: '/browse',
            items: chartPlaylists().map(cardItem),
          },
        ]
      : [],
  );

  return (
    <>
      <h1 class="sr-only">Home</h1>
      <HomeHero tracks={[...globalTracks(), ...(charts()?.tracks || [])]} />
      {globalTracks().length > 0 && <TrackShelf title="Global Top 20" tracks={globalTracks()} />}
      <Shelves shelves={curated()} />
      <Shelves shelves={shelves()} />
    </>
  );
}
