/* play.ts — the one path from any list or shelf into the queue. */

import type { Track } from '@/lib/types';
import { playerStore } from '@/store/player';

/** One song on its own (a shelf, a search row): the queue is that song, then radio top-up. */
export function playTrack(track: Track) {
  playerStore.playQueue([track], 0);
}

/** An album, playlist or list of songs, from `startIndex`. */
export function playList(tracks: Track[], startIndex = 0) {
  if (!tracks.length) return;
  playerStore.playQueue(tracks, Math.min(startIndex, tracks.length - 1));
}

/** The header's Shuffle: shuffle on, and the list from a random track. */
export function shuffleList(tracks: Track[]) {
  if (!tracks.length) return;
  if (!playerStore.shuffle) playerStore.toggleShuffle(true);
  playerStore.playQueue(tracks, Math.floor(Math.random() * tracks.length));
}
