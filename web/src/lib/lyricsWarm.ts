import { createEffect } from 'solid-js';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { playerStore } from '@/store/player';
import type { Track } from '@/lib/types';

/** The exact key the lyrics panel reads, so a warmed sheet is found, not stored under a stray name. */
const lyricsKey = (t: Track) => ['lyrics', `${t.id}|${t.title}|${(t.artists || []).join(', ')}|${t.duration}`, null, 0, 0];

const warm = (t: Track | null | undefined) => {
  if (!t) return;
  void queryClient
    .prefetchQuery({
      queryKey: lyricsKey(t),
      queryFn: ({ signal }) => api.lyrics(t, {}, signal),
      staleTime: 10 * 60_000,
    })
    .catch(() => {});
};

/**
 * Lyrics are looked up when a song STARTS, not when the panel is opened: by the time the listener
 * taps the lyrics button the sheet is already in the cache and appears on that frame. The next song
 * is warmed as well, so the change over is a fade and not a wait. Mount once, in the app frame.
 */
export function useWarmLyrics() {
  createEffect(() => warm(playerStore.current));
  createEffect(() => warm(playerStore.nextTrack()));
}
