/* api.ts — typed API client (thin fetch layer; TanStack Solid Query owns caching) */

import type {
  AlbumPage, AppleArtistArt, AppleMotionArt, ArtistPage, Card, GenreCategory, LyricsResult, Playlist,
  SearchFilter, SearchPageResult, SearchResult, SearchRow, StreamResult, Track,
} from './types';

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

const enc = encodeURIComponent;

function supportsOpusMse(): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/webm; codecs="opus"');
}

export const api = {
  search: (q: string, type = 'songs', signal?: AbortSignal) =>
    getJSON<SearchResult>(`/api/search?q=${enc(q)}&type=${enc(type)}`, signal),

  suggest: (q: string, signal?: AbortSignal) =>
    getJSON<{ items: string[] }>(`/api/suggest?q=${enc(q)}`, signal),

  /** The Search tab: one page of rows under a filter chip, in YouTube's order. */
  searchPage: (q: string, filter: SearchFilter, signal?: AbortSignal) =>
    getJSON<SearchPageResult>(`/api/search/page?q=${enc(q)}&filter=${enc(filter)}`, signal),
  searchMore: (token: string, filter: SearchFilter, signal?: AbortSignal) =>
    getJSON<SearchPageResult>(`/api/search/more?token=${enc(token)}&filter=${enc(filter)}`, signal),
  typeahead: (q: string, signal?: AbortSignal) =>
    getJSON<{ rows: SearchRow[] }>(`/api/search/typeahead?q=${enc(q)}`, signal),

  saavnSearch: (q: string, signal?: AbortSignal) =>
    getJSON<{ results: Track[] }>(`/api/saavn/search?q=${enc(q)}`, signal),

  stream: (track: Track, refresh = false, signal?: AbortSignal, wrapper = 'auto') => {
    if (track.source === 'saavn') {
      const p = new URLSearchParams({
        id: track.id,
        title: track.title || '',
        artist: (track.artists || []).join(', '),
        album: track.album || '',
        duration: track.duration ? String(track.duration) : '',
      });
      if (supportsOpusMse()) p.set('codec', 'opus');
      if (refresh) p.set('refresh', '1');
      if (wrapper !== 'auto') p.set('wrapper', wrapper);
      return getJSON<StreamResult>(`/api/saavn/stream?${p}`, signal);
    }
    const p = new URLSearchParams({
      id: track.id,
      title: track.title || '',
      artist: (track.artists || []).join(', '),
      album: track.album || '',
      duration: track.duration ? String(track.duration) : '',
    });
    if (supportsOpusMse()) p.set('codec', 'opus');
    // An upload is somebody's copy of something: resolve its official song
    // recording before streaming, then use the alternate catalogue as needed.
    if (track.isUpload) p.set('upload', '1');
    if (refresh) p.set('refresh', '1');
    if (wrapper !== 'auto') p.set('wrapper', wrapper);
    return getJSON<StreamResult>(`/api/stream?${p}`, signal);
  },

  lyrics: (
    track: Track,
    opts: { source?: string; refresh?: boolean } = {},
    signal?: AbortSignal,
  ) => {
    const p = new URLSearchParams({
      title: track.title || '',
      artist: (track.artists || []).join(', ') || '',
      album: track.album || '',
      duration: track.duration ? String(track.duration) : '',
    });
    if (track.source === 'yt') p.set('videoId', track.id);
    if (track.channel) p.set('channel', track.channel);
    const hint = (track as Track & { _q?: string })._q;
    if (hint) p.set('q', hint);
    if (opts.source) p.set('source', opts.source);
    if (opts.refresh) p.set('refresh', '1');
    return getJSON<LyricsResult>(`/api/lyrics?${p}`, signal);
  },

  genres: () => getJSON<{ categories: GenreCategory[] }>('/api/genres'),
  genrePlaylists: (params: string) =>
    getJSON<{ items: Card[]; sections: { title: string; items: Card[] }[] }>(`/api/genres/playlists?params=${enc(params)}`),
  /** The home page's rows: YouTube Music's own playlists, grouped into themes. */
  home: () =>
    getJSON<{
      charts: { tracks: Track[]; items: Card[] };
      global: { tracks: Track[] };
      genres: { categories: GenreCategory[] };
      curated: { rows: { id: string; title: string; detail: string; items: Card[] }[] };
    }>('/api/home'),
  charts: () => getJSON<{ tracks: Track[]; items: Card[] }>('/api/charts'),
  playlist: (id: string, full = false) => getJSON<Playlist>(`/api/playlist?id=${enc(id)}${full ? '&full=1' : ''}`),
  artist: (id: string, signal?: AbortSignal) => getJSON<ArtistPage>(`/api/artist?id=${enc(id)}`, signal),
  album: (id: string) => getJSON<AlbumPage>(`/api/album?id=${enc(id)}`),
  artwork: (track: Track, signal?: AbortSignal) => {
    const p = new URLSearchParams({
      title: track.title || '',
      artist: (track.artists || []).join(', '),
      album: track.album || '',
      duration: track.duration ? String(track.duration) : '',
    });
    return getJSON<{ thumb: string | null }>(`/api/artwork?${p}`, signal);
  },
  radio: (track: Track | string) => {
    if (typeof track === 'string') return getJSON<{ tracks: Track[] }>(`/api/radio?id=${enc(track)}`);
    const p = new URLSearchParams({
      id: track.source === 'yt' ? track.id : '',
      title: track.title || '',
      artist: (track.artists || []).join(', '),
      album: track.album || '',
      duration: track.duration ? String(track.duration) : '',
    });
    return getJSON<{ tracks: Track[] }>(`/api/radio?${p}`);
  },
  identify: (title: string, artist: string, duration?: number) =>
    getJSON<{ isrc: string | null; canonical: unknown; confidence: number }>(
      `/api/identify?title=${enc(title)}&artist=${enc(artist)}${duration ? `&duration=${duration}` : ''}`,
    ),

  /** Apple's own artist banner: hero, logo and the looping motion clip. */
  appleArtist: (name: string, signal?: AbortSignal) =>
    getJSON<AppleArtistArt>(`/api/apple-artist?name=${enc(name)}`, signal),
  /** Extra HD pictures of an artist (Deezer, JioSaavn) for the slow slideshow. */
  artistImages: (name: string, signal?: AbortSignal) =>
    getJSON<{ images: string[] }>(`/api/artist-images?name=${enc(name)}`, signal),
  appleMotion: (track: Track, signal?: AbortSignal) => {
    const p = new URLSearchParams({
      title: track.title || '',
      artist: track.artists?.[0] || '',
      artists: (track.artists || []).join('|'),
      album: track.album || '',
    });
    return getJSON<AppleMotionArt>(`/api/apple-motion?${p}`, signal);
  },
  /** Official YouTube Music Video resolver for the visualizer & full MV player */
  resolveMv: async (track: Track, signal?: AbortSignal) => {
    try {
      const p = new URLSearchParams({
        id: track.id || '',
        title: track.title || '',
        artist: (track.artists || []).join(', '),
        album: track.album || '',
        duration: track.duration ? String(track.duration) : '',
      });
      return await getJSON<{ videoId: string; title: string; thumbnail: string }>(`/api/mv/resolve?${p}`, signal);
    } catch {
      return { videoId: track.id, title: track.title, thumbnail: track.thumb || '' };
    }
  },
};

/** High-definition native video stream URL for HTML5 <video> */
export const videoStreamUrl = (videoId: string) => `/api/video/${encodeURIComponent(videoId)}`;

/** Same-origin image proxy (CORS-proof thumbnails for canvas/strict contexts). */
export const proxiedImg = (url: string) => `/api/img?url=${encodeURIComponent(url)}`;

