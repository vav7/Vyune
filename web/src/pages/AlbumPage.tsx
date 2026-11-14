/* AlbumPage.tsx — an album (report §3): header, numbered tracks, footer. */

import { createMemo, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { AlbumVideoBackdrop } from '@/components/music/AlbumVideoBackdrop';
import { albumVideoStore } from '@/store/albumVideo';
import { DetailHeader } from '@/components/music/DetailHeader';
import { TrackList } from '@/components/music/TrackList';
import { LoadError } from '@/components/music/States';
import { playList, shuffleList } from '@/components/music/play';
import { api } from '@/lib/api';
import { useArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { detailFooter } from '@/pages/pageStyles';
import { AlbumSkeleton } from '@/skeletons/PageSkeletons';
import { DetailSkeleton } from '@/skeletons/DetailSkeleton';
import { getNavHint } from '@/lib/navHint';

export default function AlbumPage() {
  const params = useParams();
  const id = () => params.id ?? '';

  const query = useQuery(() => ({
    queryKey: ['album', id()],
    queryFn: () => api.album(id()),
    staleTime: 30 * 60_000,
    retry: false,
    enabled: !!id(),
  }));

  // The card that led here already knew the title and the artwork: paint those on frame one.
  const hint = () => getNavHint('album', id());
  const title = () => query.data?.title ?? hint()?.title ?? '';
  const thumb = () => query.data?.thumb ?? hint()?.thumb ?? null;
  const meta = () => {
    const d = query.data;
    if (d) {
      return [d.year, tracks().length ? `${tracks().length} songs` : null, d.subtitle].filter(Boolean).join(' · ') || null;
    }
    return hint()?.subtitle ?? null;
  };
  const hasContent = () => !!query.data || !!hint();

  usePageTint(useArtworkColor(() => query.data?.thumb ?? hint()?.thumb), () => query.data?.thumb ?? hint()?.thumb);
  const on = () => albumVideoStore.on;
  const toggle = albumVideoStore.toggle;

  const tracks = createMemo(() => query.data?.tracks || []);
  const artists = createMemo(() => query.data?.artists || []);

  return (
    <Show when={query.isError} fallback={
      <Show when={hasContent()} fallback={<AlbumSkeleton />}>
        <AlbumVideoBackdrop tracks={tracks()} />
        <div class="relative z-[1]">
          <DetailHeader
            title={title()}
            subtitle="Album"
            meta={meta()}
            description={query.data?.description}
            thumbnail={thumb()}
            artists={artists()}
            canPlay={tracks().length > 0}
            onPosterClick={toggle}
            posterLabel={on() ? 'Turn off music video background' : 'Turn on music video background'}
            onPlay={() => playList(tracks(), 0, { type: 'album', title: title() })}
            onShuffle={() => shuffleList(tracks(), { type: 'album', title: title() })}
          />
          <Show when={tracks().length > 0} fallback={<DetailSkeleton header={false} rows={10} />}>
            <TrackList
              tracks={tracks()}
              variant="album"
              fallbackArtwork={thumb()}
              onPlayRow={(i) => playList(tracks(), i, { type: 'album', title: title() })}
            />
            <footer class={detailFooter}>
              {query.data?.year && <p>{query.data.year}</p>}
              {artists().length > 0 && <p>{artists().map((a) => a.name).join(', ')}</p>}
              {query.data?.subtitle && <p>{query.data.subtitle}</p>}
            </footer>
          </Show>
        </div>
      </Show>
    }>
      <LoadError error={query.error} onRetry={() => void query.refetch()} />
    </Show>
  );
}
