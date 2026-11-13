/* FavoritesPage.tsx — this device's favorite songs, as a playlist page. */

import { createMemo } from 'solid-js';
import { PageHeader } from '@/components/PageHeader';
import { DetailHeader } from '@/components/music/DetailHeader';
import { TrackList } from '@/components/music/TrackList';
import { EmptyState } from '@/components/music/States';
import { playList, shuffleList } from '@/components/music/play';
import { playerStore } from '@/store/player';

export default function FavoritesPage() {
  const favorites = createMemo(() => playerStore.favorites);

  if (!favorites().length) {
    return (
      <>
        <PageHeader title="Favorite Songs" />
        <EmptyState title="No favorites yet" detail="Star any track to keep it here. Stored on this device only." />
      </>
    );
  }

  return (
    <>
      <DetailHeader
        title="Favorite Songs"
        subtitle="Playlist"
        meta={`${favorites().length} songs · this device`}
        thumbnail={favorites()[0]?.thumb ?? null}
        canPlay
        onPlay={() => playList(favorites(), 0)}
        onShuffle={() => shuffleList(favorites())}
      />
      <TrackList tracks={favorites()} variant="playlist" />
    </>
  );
}
