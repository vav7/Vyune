import { queryClient } from './queryClient';

/**
 * Local-first caching. The pages people open again and again — home charts,
 * artists, albums, playlists, recent searches — are kept in localStorage and
 * put back in the query cache at start-up, so a repeat visit paints at once
 * and quietly refreshes behind the screen. No extra packages: the cache is
 * observed, a whitelisted slice is written (debounced, size-capped), and each
 * entry is restored with its original age so stale data still revalidates.
 */
const KEY = 'vyune-query-cache-v1';
const KEEP = new Set(['home', 'charts', 'genres', 'genre-playlists', 'artist', 'album', 'playlist', 'search-group', 'apple-art', 'apple-motion', 'catalog-artwork']);
const MAX_BYTES = 1_400_000;
const MAX_AGE = 3 * 24 * 3600_000;

interface Saved {
  key: unknown[];
  data: unknown;
  at: number;
}

export function restoreQueryCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]') as Saved[];
    const now = Date.now();
    for (const entry of saved) {
      if (!entry?.key || now - entry.at > MAX_AGE) continue;
      queryClient.setQueryData(entry.key, entry.data, { updatedAt: entry.at });
    }
  } catch {
    // a damaged cache is simply ignored
  }
}

function save() {
  try {
    const rows: Saved[] = [];
    for (const query of queryClient.getQueryCache().getAll()) {
      const head = query.queryKey[0];
      if (typeof head !== 'string' || !KEEP.has(head) || query.state.status !== 'success') continue;
      rows.push({ key: query.queryKey as unknown[], data: query.state.data, at: query.state.dataUpdatedAt });
    }
    // Newest first; stop adding once the budget is spent.
    rows.sort((a, b) => b.at - a.at);
    let size = 0;
    const out: Saved[] = [];
    for (const row of rows) {
      const text = JSON.stringify(row);
      size += text.length;
      if (size > MAX_BYTES) break;
      out.push(row);
    }
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // storage full or unavailable: the app works the same without it
  }
}

export function startQueryPersist() {
  if (typeof window === 'undefined') return;
  restoreQueryCache();
  let timer = 0;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(save) : save()), 2500);
  });
}
