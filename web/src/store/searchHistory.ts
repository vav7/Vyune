/* searchHistory.ts — recent searches: a typed query is kept as a
 * plain query row, and a result you opened or played is kept as an entity row
 * with its artwork, so "Recent searches" shows the things themselves. */

import { createSignal } from 'solid-js';
import { readLS, writeLS } from './persist';
import type { Track } from '@/lib/types';

export type HistoryKind = 'query' | 'song' | 'artist' | 'album' | 'playlist';

export interface HistoryEntry {
  /** Stable key: queries are `q:<lowercase text>`, entities their own id. */
  key: string;
  kind: HistoryKind;
  title: string;
  subtitle?: string | null;
  thumb?: string | null;
  /** The entity's id (browse id, or video id for a song). */
  id?: string;
  /** A song's full track, so tapping it plays without another lookup. */
  track?: Track;
}

const KEY = 'vyune-search-history-v2';
const MAX = 20;

const [entries, setEntries] = createSignal<HistoryEntry[]>(readLS<HistoryEntry[]>(KEY, []));

const save = (next: HistoryEntry[]) => {
  setEntries(next);
  writeLS(KEY, next);
};

function add(entry: HistoryEntry) {
  save([entry, ...entries().filter((e) => e.key !== entry.key)].slice(0, MAX));
}

export const searchHistory = {
  entries,
  addQuery(text: string) {
    const title = text.trim();
    if (title) add({ key: `q:${title.toLowerCase()}`, kind: 'query', title });
  },
  addTrack(track: Track) {
    add({
      key: `song:${track.id}`,
      kind: 'song',
      id: track.id,
      title: track.title,
      subtitle: (track.artists || []).join(', ') || null,
      thumb: track.thumb,
      track,
    });
  },
  addBrowse(item: { id: string; kind: 'artist' | 'album' | 'playlist'; title: string; subtitle?: string | null; thumb?: string | null }) {
    add({ key: `${item.kind}:${item.id}`, kind: item.kind, id: item.id, title: item.title, subtitle: item.subtitle, thumb: item.thumb });
  },
  remove(key: string) {
    save(entries().filter((e) => e.key !== key));
  },
  clear() {
    save([]);
  },
};
