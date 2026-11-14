/* PlaylistPage.tsx — a playlist (report §14): header, then the artwork track
 * list. */

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
import { PlaylistSkeleton } from '@/skeletons/PageSkeletons';
import { DetailSkeleton } from '@/skeletons/DetailSkeleton';
import { getNavHint } from '@/lib/navHint';
import { queryClient } from '@/lib/queryClient';
import { createEffect } from 'solid-js';

/** The whole running time, as a listener reads it: "42 min, 18 sec". */
function totalRuntime(tracks: { duration?: number }[]): string | null {
  const seconds = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

export default function PlaylistPage() {
  const params = useParams();
  const id = () => params.id ?? '';

  const query = useQuery(() => ({
    queryKey: ['playlist', id()],
    queryFn: () => api.playlist(id()),
    staleTime: 30 * 60_000,
    retry: false,
    enabled: !!id(),
  }));

  // The server answers with the first page at once and completes long lists behind it.
  // Ask for the finished list as soon as page one is on screen; it is normally already cached.
  createEffect(() => {
    const first = query.data;
    const pid = id();
    if (!first?.partial || !pid) return;
    void api.playlist(pid, true).then((full) => {
      if (full?.tracks?.length && id() === pid) queryClient.setQueryData(['playlist', pid], { ...full, partial: false });
    }).catch(() => {});
  });

  const hint = () => getNavHint('playlist', id());
  const title = () => query.data?.title ?? hint()?.title ?? '';
  const thumb = () => query.data?.thumb ?? hint()?.thumb ?? null;
  const meta = () => {
    const d = query.data;
    if (d) {
      return [tracks().length ? `${tracks().length} songs` : null, runtime(), d.subtitle].filter(Boolean).join(' · ') || null;
    }
    return hint()?.subtitle ?? null;
  };
  const hasContent = () => !!query.data || !!hint();

  usePageTint(useArtworkColor(() => query.data?.thumb ?? hint()?.thumb), () => query.data?.thumb ?? hint()?.thumb);
  const on = () => albumVideoStore.on;
  const toggle = albumVideoStore.toggle;

  const tracks = createMemo(() => query.data?.tracks || []);
  const runtime = createMemo(() => totalRuntime(tracks()));

  return (
    <Show when={query.isError} fallback={
      <Show when={hasContent()} fallback={<PlaylistSkeleton />}>
        <AlbumVideoBackdrop tracks={tracks()} />
        <div class="relative z-[1]">
          <DetailHeader
            title={title()}
            subtitle="Playlist"
            meta={meta()}
            thumbnail={thumb()}
            canPlay={tracks().length > 0}
            onPosterClick={toggle}
            posterLabel={on() ? 'Turn off music video background' : 'Turn on music video background'}
            onPlay={() => playList(tracks(), 0, { type: 'playlist', title: title() })}
            onShuffle={() => shuffleList(tracks(), { type: 'playlist', title: title() })}
          />
          <Show when={tracks().length > 0} fallback={<DetailSkeleton header={false} rowArtwork rows={8} />}>
            <TrackList
              tracks={tracks()}
              variant="playlist"
              onPlayRow={(i) => playList(tracks(), i, { type: 'playlist', title: title() })}
            />
            <Show when={query.data?.subtitle}>
              <footer class={detailFooter}>
                <p>{query.data!.subtitle}</p>
              </footer>
            </Show>
          </Show>
        </div>
      </Show>
    }>
      <LoadError error={query.error} onRetry={() => void query.refetch()} />
    </Show>
  );
}
