/**
 * feeds.js — the home feed, built from the official regional JioSaavn charts
 * and playlist feeds.
 *
 * The feed used to be a shelf of user-made YouTube playlists. That was noise:
 * anybody's playlist, mixed genres, half of it re-uploads, and nothing that
 * told the listener where in the world the music came from. The regional
 * JioSaavn feeds are the real thing — the catalogue's own trending list, its
 * official chart playlists, its editors' playlists and its new releases — so
 * the feed is assembled from those instead.
 *
 * The upstream is JioSaavn's own api.php. The calls that answer are:
 *
 *   content.getTrending          → the trending list (songs)
 *   content.getCharts            → the official chart playlists, by region
 *   content.getFeaturedPlaylists → the editors' playlists
 *   content.getAlbums            → new releases
 *   playlist.getDetails          → one playlist's rows
 *
 * "Top Songs" is exactly 25 slots. The trending feed carries 24 songs, so the
 * shelf is topped up from the regional chart and trimmed to 25 — the home
 * page never changes shape.
 */

import { safeFetch, UA, TTLCache, AsyncResolver } from './cache.js';
import { mapSaavnTrack } from './saavn.js';

const API = 'https://www.jiosaavn.com/api.php';

/** The Indian residential address the catalogue answers to. */
const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  'X-Forwarded-For': '49.36.0.1',
  'X-Real-IP': '49.36.0.1',
  'Accept-Language': 'en-IN,en;q=0.9',
  Cookie: 'explicit_content=1',
};

const playlistCache = new AsyncResolver(new TTLCache({ max: 120, ttl: 6 * 3600_000 }), { ttl: 6 * 3600_000 });

async function apiGet(params, timeout = 8000) {
  const query = new URLSearchParams({ _format: 'json', api_version: '4', ctx: 'android', ...params });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await safeFetch(`${API}?${query}`, { headers: HEADERS, timeout });
    if (!res || !res.ok) continue;
    try {
      const json = await res.json();
      if (json && typeof json === 'object' && !json.error) return json;
    } catch {
      /* an HTML hiccup page — try again */
    }
  }
  return null;
}

const asArray = (value) => (Array.isArray(value) ? value : []);

/** The catalogue's own picture for a chart or playlist row. */
const imageOf = (row) => {
  const image = row?.image;
  if (!image) return null;
  const list = asArray(image);
  const best = list.length ? list[list.length - 1] : image;
  const url = typeof best === 'string' ? best : best?.url || best?.link;
  if (!url) return null;
  return String(url).replace(/-(50x50|150x150|500x500)(\.\w+)?$/, '') + '-500x500.jpg';
};

const stripTags = (value) =>
  String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

/** Only the song rows: these feeds also carry playlists and albums. */
const songRows = (rows) => asArray(rows).filter((row) => row?.type === 'song' && row?.id);

/**
 * A JioSaavn playlist, resolved for the playlist page.
 * The rows are the catalogue's own, so they play from the catalogue stream.
 */
export async function saavnPlaylist(id) {
  const listId = String(id || '').replace(/\D/g, '');
  if (!listId) return null;
  const key = `savnpl:${listId}`;
  const cached = await playlistCache.resolve(key, async () => {
    const json = await apiGet({ __call: 'playlist.getDetails', listid: listId, p: '1', n: '100' });
    if (!json) return null;
    const tracks = songRows(json.list).map((row) => mapSaavnTrack(row)).filter((track) => track?.id && track.title);
    return {
      id: listId,
      title: stripTags(json.title || 'Playlist'),
      subtitle: stripTags(json.subtitle || '') || `${tracks.length} songs`,
      thumb: imageOf(json),
      tracks,
      source: 'saavn',
    };
  });
  return cached || null;
}
