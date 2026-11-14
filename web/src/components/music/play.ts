/* play.ts — the one path from any list or shelf into the queue. */

import type { Track } from '@/lib/types';
import { playerStore, type PlayContext } from '@/store/player';

/** One song on its own (a shelf, a search row): the queue is that song, then radio top-up. */
export function playTrack(track: Track, context?: PlayContext) {
  playerStore.playQueue([track], 0, { context });
}

/** An album, playlist or list of songs, from `startIndex`. */
export function playList(tracks: Track[], startIndex = 0, context?: PlayContext) {
  if (!tracks.length) return;
  playerStore.playQueue(tracks, Math.min(startIndex, tracks.length - 1), { context });
}

/** The header's Shuffle: shuffle on, and the list from a random track. */
export function shuffleList(tracks: Track[], context?: PlayContext) {
  if (!tracks.length) return;
  if (!playerStore.shuffle) playerStore.toggleShuffle(true);
  playerStore.playQueue(tracks, Math.floor(Math.random() * tracks.length), { context });
}
