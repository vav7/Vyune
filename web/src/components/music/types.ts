/* types.ts — the shelf/lockup item for Track/Card payloads. */

import type { Card, Track } from '@/lib/types';
import { cardKind, type ItemKind } from './links';

export interface MusicItem {
  kind: ItemKind;
  id: string;
  title: string;
  subtitle: string;
  artists: string[];
  artistIds?: (string | null | undefined)[];
  album?: string | null;
  albumId?: string | null;
  thumbnail?: string | null;
  durationSec?: number | null;
  explicit?: boolean;
  /** The full track behind a song item, so a shelf row queues the real thing. */
  track?: Track;
}

export function trackItem(t: Track): MusicItem {
  return {
    kind: 'song',
    id: t.id,
    title: t.title,
    subtitle: t.album || '',
    artists: t.artists || [],
    artistIds: t.artistIds,
    album: t.album,
    albumId: t.albumId,
    thumbnail: t.thumb,
    durationSec: t.duration || null,
    explicit: !!t.explicit,
    track: t,
  };
}

export function cardItem(c: Card): MusicItem {
  return {
    kind: cardKind(c),
    id: c.id,
    title: c.title,
    subtitle: c.subtitle || '',
    artists: [],
    thumbnail: c.thumb,
  };
}

/** A titled horizontal shelf (report §2 shape). */
export interface Shelf {
  title: string;
  layout: 'square' | 'tracks' | 'video' | 'circle';
  items: MusicItem[];
  /** A line under the title. */
  detail?: string;
  /** Extra class on the section (styling hook). */
  className?: string;
  /** A route behind the title's chevron. */
  seeAll?: string | null;
  /** For `tracks`: the real tracks, so any row plays the whole shelf. */
  tracks?: Track[];
}

export const isPlayable = (item: MusicItem) => item.kind === 'song';
