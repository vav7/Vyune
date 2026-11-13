/* links.ts — where an item goes, and how a runtime reads. */

import type { Card, Track } from '@/lib/types';

export type ItemKind = 'song' | 'album' | 'playlist' | 'artist' | 'radio' | 'unknown';

/** Where tapping an item goes; null for songs, which play instead. */
export function hrefFor(kind: ItemKind, id: string): string | null {
  switch (kind) {
    case 'album':
      return `/album/${encodeURIComponent(id)}`;
    case 'playlist':
    case 'radio':
      return `/playlist/${encodeURIComponent(id)}`;
    case 'artist':
      return `/artist/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

export const artistHref = (id: string | null | undefined): string | null =>
  id ? `/artist/${encodeURIComponent(id)}` : null;

export const albumHref = (id: string | null | undefined): string | null =>
  id ? `/album/${encodeURIComponent(id)}` : null;

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * A Card's kind, defaulting to playlist (charts/genre shelves are playlists).
 *
 * A card whose kind is missing is worked out from its id. The kind decides
 * where the card goes, and a missing one sent an artist row to the playlist
 * page — which answered 404, because an artist's browse id is not a
 * playlist's.
 */
export function cardKind(card: Card): ItemKind {
  if (card.kind) return card.kind as ItemKind;
  const id = String(card.id || '');
  if (id.startsWith('UC')) return 'artist';
  if (id.startsWith('MPRE')) return 'album';
  if (id.startsWith('VLRD') || id.startsWith('RD')) return 'radio';
  return 'playlist';
}

export type { Card, Track };

/** An artist's page when the id is known, otherwise a search for the name: every credit leads somewhere. */
export function artistLink(id: string | null | undefined, name: string): string | null {
  if (id) return `/artist/${encodeURIComponent(id)}`;
  const clean = name.trim();
  return clean && !/^(various artists|unknown)/i.test(clean) ? `/search?q=${encodeURIComponent(clean)}` : null;
}
