/**
 * VYUNE — server entry.
 *
 * A lean Hono API in front of:
 *   • YouTube.js (InnerTube)  — search, suggestions, genres, playlists, radio,
 *                               YT Music lyrics, stream resolution cascade
 *   • JioSaavn (direct)       — search + 320kbps streaming fallback
 *
 * The runtime is Bun (`bun server/index.js`): one process, Bun's HTTP server
 * in front of Hono's router, and no Node.js in the loop.
 *
 * Everything is cached; nothing blocks; the static frontend is served from ./dist.
 */

import { curatedHome } from './curated.js';
import { Hono } from 'hono';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'node:fs';
import { etag } from 'hono/etag';
import { TTLCache, AsyncResolver, withTimeout, persistCaches } from './cache.js';
import * as yt from './yt.js';
import * as saavn from './saavn.js';
import { artistImages } from './artistimages.js';
import { normalizeFilter, searchContinuation, searchPage, searchSuggestions, searchTypeahead } from './search.js';
import { identify } from './identify.js';
import { registerProxies } from './proxy.js';
import { globalTopTracks } from './globalcharts.js';
import { spotifyTrack } from './spotify.js';
import { artistArt, trackMotionArt, trackMusicVideos, warmAppleCatalog } from './appleart.js';
import { ranked as rankRecordings } from './match.js';
import { saavnPlaylist } from './feeds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load optional local environment values without a runtime dependency. Real
// deployment secrets should be set in the host's environment variables.
try {
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const entry = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!entry || process.env[entry[1]] !== undefined) continue;
    const value = entry[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\s+#.*$/, '');
    process.env[entry[1]] = value;
  }
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[config] could not read .env:', err.message);
}

const PORT = Number(process.env.PORT || 3000);

const app = new Hono();

/* Process-level guard rails: a weird upstream response must never take the
   whole server down. Log and keep serving. */
process.on('unhandledRejection', (err) => {
  console.error('[process] unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err?.message || err);
});

/**
 * Every API answer is checked again on the next request.
 *
 * The browser is allowed to keep a response it has already seen, and these
 * answers change shape as the engine improves — an artist's banner went from
 * a square tile to Apple's own photograph, and a stale copy kept the old one
 * on screen for a day. The server caches what it can; the browser should not
 * keep an answer the server would give again.
 */
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-cache');
  await next();
});
// Revalidation without re-sending: the browser asks "still this version?" and gets a 304 with no body.
// Content routes only; media and image proxies stream and must never be buffered for hashing.
for (const route of ['home', 'charts', 'genres', 'genres/playlists', 'playlist', 'album', 'artist', 'search', 'search/page', 'lyrics', 'apple-motion', 'track']) {
  app.use(`/api/${route}`, etag());
}

app.onError((err, c) => {
  console.error(`[api] ${c.req.path}:`, err?.message || err);
  return c.json({ error: 'internal' }, 500);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

/* CORS-proof asset proxies (images + Range-capable media) */
registerProxies(app);

/* ---------------- caches ---------------- */

const searchCache = new AsyncResolver(new TTLCache({ max: 400, ttl: 10 * 60_000 }), { ttl: 10 * 60_000 });
const suggestCache = new AsyncResolver(new TTLCache({ max: 800, ttl: 30 * 60_000 }), { ttl: 30 * 60_000 });
const genreCache = new AsyncResolver(new TTLCache({ max: 10, ttl: 24 * 3600_000 }), { ttl: 24 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const genrePlCache = new AsyncResolver(new TTLCache({ max: 60, ttl: 12 * 3600_000 }), { ttl: 12 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const playlistCache = new AsyncResolver(new TTLCache({ max: 200, ttl: 6 * 3600_000 }), { ttl: 6 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const chartsCache = new AsyncResolver(new TTLCache({ max: 5, ttl: 6 * 3600_000 }), { ttl: 6 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const artistCache = new AsyncResolver(new TTLCache({ max: 300, ttl: 12 * 3600_000 }), { ttl: 12 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const albumCache = new AsyncResolver(new TTLCache({ max: 300, ttl: 12 * 3600_000 }), { ttl: 12 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const trackCache = new AsyncResolver(new TTLCache({ max: 500, ttl: 24 * 3600_000 }), { ttl: 24 * 3600_000, staleFor: 7 * 24 * 3600_000 });
const artworkCache = new AsyncResolver(new TTLCache({ max: 600, ttl: 24 * 3600_000 }), { ttl: 24 * 3600_000 });
// Stream URLs: googlevideo ~6h validity, saavn CDN long-lived — cache 45min.
const streamCache = new AsyncResolver(new TTLCache({ max: 600, ttl: 45 * 60_000 }), { ttl: 45 * 60_000 });

/* ---------------- search ----------------
 * The Search tab's engine (search.js): YouTube Music's
 * own filtered search in YouTube's own order, paged by continuation token,
 * plus a suggestions call and an unfiltered typeahead. Nothing re-ranks it. */

const rowsOnly = (page) => (page ? { rows: page.rows, continuation: page.continuation } : null);

/** GET /api/search/page?q=&filter=all|songs|videos|albums|artists|playlists */
app.get('/api/search/page', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  const filter = normalizeFilter(c.req.query('filter'));
  if (!q) return c.json({ query: q, filter, rows: [], continuation: null });
  // A search that failed says nothing about the query, so it is never cached.
  const page = await searchCache.resolve(`page:${filter}:${q.toLowerCase()}`, async () =>
    rowsOnly(await searchPage(q, filter)),
  );
  if (!page) return c.json({ error: 'search_temporarily_unavailable' }, 503);
  return c.json({ query: q, filter, ...page });
});

/** GET /api/search/more?token=&filter= — the next page of a search. */
app.get('/api/search/more', async (c) => {
  const token = String(c.req.query('token') || '').trim();
  const filter = normalizeFilter(c.req.query('filter'));
  if (!token) return c.json({ rows: [], continuation: null });
  const page = rowsOnly(await searchContinuation(token, filter));
  if (!page) return c.json({ error: 'search_temporarily_unavailable' }, 503);
  return c.json({ filter, ...page });
});

/** GET /api/search/typeahead?q= — live song/artist/album rows while typing. */
app.get('/api/search/typeahead', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  if (!q) return c.json({ rows: [] });
  const rows = await suggestCache.resolve(`ta:${q.toLowerCase()}`, async () => {
    const found = await searchTypeahead(q);
    return found?.length ? found : null; // an empty answer is a hiccup, never kept
  });
  return c.json({ rows: rows || [] });
});

/** GET /api/suggest?q= — what the search box would complete the text to. */
app.get('/api/suggest', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  if (!q) return c.json({ items: [] });
  const items =
    (await suggestCache.resolve(`sg:${q.toLowerCase()}`, async () => {
      const found = await searchSuggestions(q);
      return found.length ? found : null;
    })) || [];
  return c.json({ items });
});

/**
 * GET /api/search?q=&type=songs|albums|artists|playlists|videos
 * The flat list other pages (Go, Home shelves) ask for. It is the same
 * filtered search as above, flattened, in YouTube's order.
 */
app.get('/api/search', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  const type = String(c.req.query('type') || 'songs').toLowerCase();
  if (!q) return c.json({ query: q, type, results: [] });
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 40);
  const filter = normalizeFilter(type);
  const page = await searchCache.resolve(`page:${filter}:${q.toLowerCase()}`, async () =>
    rowsOnly(await searchPage(q, filter)),
  );
  if (!page) return c.json({ error: 'search_temporarily_unavailable' }, 503);
  const results = page.rows
    .filter((row) => (row.kind === 'browse' ? filter !== 'all' && filter !== 'songs' : true))
    .map((row) => (row.kind === 'browse' ? row.item : row.track))
    .slice(0, limit);
  return c.json({ query: q, type, results });
});

/* ---------------- streaming ---------------- */

/**
 * GET /api/stream?id=<videoId>&title=&artist=&upload=1
 *   → { url, source: 'yt', mime, bitrate }
 * Resolve the selected YouTube Music recording first, then use a strict match
 * from its official Songs shelf and JioSaavn if that ID is unavailable.
 * `refresh=1` bypasses the cache.
 */
function officialSongMatches(tracks, title, artist, album, duration) {
  const candidates = (tracks || []).filter((track) => track?.id && !track.isUpload).map((track) => ({
    ...track,
    artist: (track.artists || []).join(', '),
    durationSec: track.duration || null,
    isExplicit: track.explicit ?? null,
  }));
  return rankRecordings(candidates, {
    title,
    artist,
    album: album || null,
    durationSec: duration || null,
    isExplicit: null,
    isVideo: false,
  });
}

app.get('/api/stream', async (c) => {
  const id = String(c.req.query('id') || '').trim();
  const title = String(c.req.query('title') || '').trim();
  const artist = String(c.req.query('artist') || '').trim();
  const album = String(c.req.query('album') || '').trim();
  const duration = parseFloat(c.req.query('duration') || '0') > 0 ? parseFloat(c.req.query('duration') || '0') : 0;
  if (!id) return c.json({ error: 'id required' }, 400);
  const refresh = c.req.query('refresh') === '1';
  const preferOpus = c.req.query('codec') === 'opus';
  const wrapper = String(c.req.query('wrapper') || 'auto');
  // The row is somebody's upload rather than the catalogue's own audio.
  const isUpload = c.req.query('upload') === '1';

  const key = `st:${id}${isUpload ? ':u' : ''}${preferOpus ? ':opus' : ''}:${wrapper}`;
  if (refresh) {
    streamCache.cache.delete(key);
    yt.resetSession(); // stale player cipher → fresh session for the retry
  }

  const out = await streamCache.resolve(key, async () => {
    const withProxy = (o) => {
      const params = new URLSearchParams({ url: o.url });
      if (Number.isSafeInteger(o.contentLength) && o.contentLength > 0) params.set('size', String(o.contentLength));
      return { ...o, proxy: `/api/media?${params}` };
    };

    // 0) The catalogue first, always.
    //
    // Prefer an exact Saavn catalogue stream when present. If it is absent,
    // resolve the selected YouTube recording and then the official Songs
    // shelf. The media proxy forwards Google Video byte ranges and the
    // YouTube client headers required by the resolver.
    const tryVideo = async (videoId) => {
      if (!videoId) return null;
      const stream = await yt.resolveStream(videoId, { preferOpus, wrapper });
      return stream
        ? withProxy({ url: stream.url, source: 'yt', mime: stream.mime, bitrate: stream.bitrate, contentLength: stream.contentLength })
        : null;
    };

    // JioSaavn is the normal first choice, but its title lookup and CDN
    // probe used to block the YouTube resolver in series. Start both paths
    // together: take Saavn when it is ready during a short priority window,
    // otherwise use the already-resolving YouTube stream immediately.
    const saavnPromise =
      wrapper !== 'yt-dlp' && title && artist
        ? (async () => {
            let match = await saavn.findSaavnMatch(title, artist, { album, duration });
            if (!match) {
              // Spotify's canonical naming (when configured) is a second way to ask the catalogue.
              const canon = await spotifyTrack(title, artist).catch(() => null);
              if (canon && (canon.title !== title || canon.artists[0] !== artist)) {
                match = await saavn.findSaavnMatch(canon.title, canon.artists.join(', '), {
                  album: canon.album || album,
                  duration: canon.durationSec || duration,
                });
              }
            }
            if (!match) return null;
            const media = await saavn.saavnStreamUrl(match);
            return media ? { url: media.url, source: 'saavn', bitrate: media.bitrate, mime: 'audio/mp4' } : null;
          })().catch(() => null)
        : Promise.resolve(null);

    const youtubePromise = (async () => {
      // Uploads are first mapped to the official Songs shelf.
      if (isUpload && title) {
        const hits = await yt.searchSongs(`${title} ${artist}`.trim(), 8);
        for (const candidate of officialSongMatches(hits, title, artist, album, duration).slice(0, 4)) {
          const stream = await tryVideo(candidate.id);
          if (stream) return stream;
        }
      }

      const direct = await tryVideo(id);
      if (direct) return direct;

      // A stale ID may still have an exact official catalog recording.
      if (!isUpload && title) {
        const hits = await yt.searchSongs(`${title} ${artist}`.trim(), 8);
        for (const candidate of officialSongMatches(hits, title, artist, album, duration).slice(0, 4)) {
          if (candidate.id === id) continue;
          const stream = await tryVideo(candidate.id);
          if (stream) return stream;
        }
      }
      return null;
    })().catch(() => null);

    const saavnFirst = await withTimeout(saavnPromise, 4_500, null);
    if (saavnFirst) return saavnFirst;
    // If Saavn has no verified match (or its lookup/CDN is stalled), don't
    // make the listener wait for its remaining alternate queries.
    const viaYoutube = await youtubePromise;
    if (viaYoutube) return viaYoutube;
    // YouTube had nothing: a Saavn answer that arrived late still beats an error.
    return await saavnPromise;
  });

  if (!out) {
    return c.json(
      {
        error: 'no_stream',
        hint: 'No playable official stream was available from YouTube or JioSaavn for this recording.',
      },
      503,
    );
  }
  return c.json(out);
});

/** GET /api/saavn/search?q= — dedicated saavn search (browse the Indian catalog). */
app.get('/api/saavn/search', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  if (!q) return c.json({ results: [] });
  const results = await searchCache.resolve(`sv:${q}`, async () => {
    const raw = await saavn.saavnSearch(q, 20);
    return raw.map((t) => ({ ...t, encrypted: undefined }));
  });
  return c.json({ results });
});

/** GET /api/saavn/stream?id= */
app.get('/api/saavn/stream', async (c) => {
  const id = String(c.req.query('id') || '').trim();
  if (!id) return c.json({ error: 'id required' }, 400);
  const title = String(c.req.query('title') || '').trim();
  const artist = String(c.req.query('artist') || '').trim();
  const album = String(c.req.query('album') || '').trim();
  const duration = parseFloat(c.req.query('duration') || '0') > 0 ? parseFloat(c.req.query('duration') || '0') : 0;
  const preferOpus = c.req.query('codec') === 'opus';
  const wrapper = String(c.req.query('wrapper') || 'auto');
  const key = `svst:${id}${preferOpus ? ':opus' : ''}:${wrapper}`;
  if (c.req.query('refresh') === '1') streamCache.cache.delete(key);
  const out = await streamCache.resolve(key, async () => {
    if (wrapper !== 'yt-dlp') {
      const media = await saavn.saavnStreamUrl({ id });
      if (media) return { url: media.url, source: 'saavn', bitrate: media.bitrate, mime: 'audio/mp4' };
    }

    // Saavn catalogs the request but its CDN can lack or refuse the stream.
    // Keep the selected song alive by resolving its exact official YT audio.
    if (!title || !artist) return null;
    const hits = await yt.searchSongs(`${title} ${artist}`.trim(), 8);
    for (const candidate of officialSongMatches(hits, title, artist, album, duration).slice(0, 4)) {
      const stream = await yt.resolveStream(candidate.id, { preferOpus, wrapper });
      if (stream) {
        const params = new URLSearchParams({ url: stream.url });
        if (Number.isSafeInteger(stream.contentLength) && stream.contentLength > 0) {
          params.set('size', String(stream.contentLength));
        }
        return {
          url: stream.url,
          proxy: `/api/media?${params}`,
          source: 'yt',
          mime: stream.mime,
          bitrate: stream.bitrate,
          contentLength: stream.contentLength,
        };
      }
    }
    return null;
  });
  if (!out) return c.json({ error: 'no_stream' }, 503);
  return c.json(out);
});

/* ---------------- browse: genres, charts, playlists, radio ---------------- */

app.get('/api/genres', async (c) => {
  const cats = await genreCache.resolve('genres', () => yt.genreCategories());
  return c.json({ categories: cats || [] });
});

app.get('/api/genres/playlists', async (c) => {
  const params = String(c.req.query('params') || '');
  if (!params) return c.json({ error: 'params required' }, 400);
  const result = await genrePlCache.resolve(`gpl:${params}`, () => yt.genrePlaylists(params));
  return c.json({ items: result?.items || [], sections: result?.sections || [] });
});

app.get('/api/charts', async (c) => {
  const c2 = await chartsCache.resolve('charts', () => yt.chartsContent());
  return c.json({ tracks: c2?.tracks || [], items: c2?.playlists || [] });
});


/**
 * GET /api/home — everything the home page needs, in ONE request.
 *
 * The page used to open four cold requests (charts, global charts, genres, curated rows), each stuck behind
 * its own upstream. Now they run together, each bounded to 4 s and individually allowed to fail, and the
 * assembled answer is cached stale-while-revalidate and persisted: after the first visit the page paints
 * from a snapshot while the fresh one is fetched.
 */
const homeCache = new AsyncResolver(new TTLCache({ max: 4, ttl: 10 * 60_000 }), { ttl: 10 * 60_000, staleFor: 24 * 3600_000, negativeTtl: 8_000 });
const part = (promise, fallback, timeoutMs = 5_000) => withTimeout(Promise.resolve(promise).catch(() => fallback), timeoutMs, fallback);

async function buildHome() {
  const [charts, global, genres, curated] = await Promise.all([
    part(chartsCache.resolve('charts', () => yt.chartsContent()), null, 6_000),
    part(globalTopTracks(20), [], 10_000),
    part(genreCache.resolve('genres', () => yt.genreCategories()), null, 6_000),
    part(curatedHome(), null, 6_000),
  ]);
  const out = {
    charts: { tracks: charts?.tracks || [], items: charts?.playlists || [] },
    global: { tracks: global || [] },
    genres: { categories: genres || [] },
    curated: { rows: curated?.rows || [] },
  };
  const empty = !out.charts.tracks.length && !out.global.tracks.length && !out.curated.rows.length;
  return empty ? null : out; // nothing at all is a miss, not an answer to keep
}

app.get('/api/home', async (c) => c.json((await homeCache.resolve('home', buildHome)) || { charts: { tracks: [], items: [] }, global: { tracks: [] }, genres: { categories: [] }, curated: { rows: [] } }));

app.get('/api/playlist', async (c) => {
  const id = String(c.req.query('id') || '');
  if (!id) return c.json({ error: 'id required' }, 400);

  // A numeric id is a JioSaavn playlist — handle directly without stalling on YouTube
  if (/^\d+$/.test(id)) {
    const regional = await playlistCache.resolve(`saavn_pl:${id}`, () => saavnPlaylist(id));
    if (regional) return c.json(regional);
  }

  // First paint must not wait on a long playlist's continuation pages: answer with page one
  // (≈1 round trip) and finish the rest behind it. The client asks again with full=1 and
  // finds the complete list already cached.
  const wantFull = c.req.query('full') === '1';
  const fullKey = `pl:${id}`;
  let pl;
  if (wantFull || playlistCache.cache.get(fullKey) !== undefined) {
    pl = await playlistCache.resolve(fullKey, () => yt.getPlaylist(id));
  } else {
    pl = await playlistCache.resolve(`pl1:${id}`, () => yt.getPlaylist(id, { pages: 0 }));
    if (pl && !pl.partial) {
      playlistCache.cache.set(fullKey, pl);
    } else if (pl?.partial) {
      playlistCache.warm(fullKey, () => yt.getPlaylist(id));
    }
  }
  if (pl) return c.json(pl);
  return c.json({ error: 'not_found' }, 404);
});

app.get('/api/radio', async (c) => {
  const id = String(c.req.query('id') || '').trim();
  const title = String(c.req.query('title') || '').trim();
  const artist = String(c.req.query('artist') || '').trim();
  const album = String(c.req.query('album') || '').trim();
  const duration = parseFloat(c.req.query('duration') || '0') > 0 ? parseFloat(c.req.query('duration') || '0') : 0;
  let seedId = id;
  if (!seedId && title) {
    // JioSaavn remains the preferred source for the selected track. Resolve
    // its matching official YouTube Music song only as a seed for YouTube's
    // own recommendation queue for catalog songs.
    const hits = await yt.searchSongs(`${title} ${artist}`.trim(), 10);
    seedId = officialSongMatches(hits, title, artist, album, duration)[0]?.id || '';
  }
  if (!seedId) return c.json({ tracks: [] });
  const tracks = await searchCache.resolve(`radio:${seedId}`, () => yt.getRadio(seedId));
  return c.json({ tracks });
});

/** Lightweight track card for share links (/t/:id) — metadata only. */
app.get('/api/track', async (c) => {
  const id = String(c.req.query('id') || '');
  if (!id) return c.json({ error: 'id required' }, 400);
  const t = await trackCache.resolve(`tk:${id}`, () => yt.getTrackCard(id));
  if (!t) return c.json({ error: 'not_found' }, 404);
  return c.json(t);
});

/* ---------------- artist / album / identity ---------------- */

app.get('/api/artist', async (c) => {
  const id = String(c.req.query('id') || '');
  if (!id) return c.json({ error: 'id required' }, 400);
  const key = `ar:${id}`;
  const page = await artistCache.resolve(key, () => yt.getArtistPage(id));
  if (!page) return c.json({ error: 'artist_temporarily_unavailable' }, 503);
  // Do not cache a transient empty InnerTube response or present a blank
  // artist shell as a successful page; the client retries this 503.
  if (!page.topSongs?.length && !page.discography?.length && !page.sections?.some((s) => s.items?.length)) {
    artistCache.cache.delete(key);
    return c.json({ error: 'artist_temporarily_unavailable' }, 503);
  }
  return c.json(page);
});

app.get('/api/album', async (c) => {
  const id = String(c.req.query('id') || '');
  if (!id) return c.json({ error: 'id required' }, 400);
  const key = `al:${id}`;
  const page = await albumCache.resolve(key, () => yt.getAlbumPage(id));
  if (!page) return c.json({ error: 'not_found' }, 404);
  if (!page.tracks?.length) albumCache.cache.delete(key);
  return c.json(page);
});

// Resolve alternate sleeve art from the exact JioSaavn catalogue recording.
// The result is cached by song identity so changing tracks stays off this path.
app.get('/api/artwork', async (c) => {
  const title = String(c.req.query('title') || '').trim();
  const artist = String(c.req.query('artist') || '').trim();
  const album = String(c.req.query('album') || '').trim();
  const duration = parseFloat(c.req.query('duration') || '0') > 0 ? parseFloat(c.req.query('duration') || '0') : 0;
  if (!title) return c.json({ error: 'title required' }, 400);
  const key = [title, artist, album, duration ? Math.round(duration) : ''].join('|').toLowerCase();
  const thumb = await artworkCache.resolve(`art:${key}`, async () => {
    const match = await saavn.findSaavnMatch(title, artist, { album, duration });
    return match?.thumb || null;
  });
  return c.json({ thumb: thumb || null });
});

/**
 * Apple's own artist banner: the hero photograph, the title logo typeset
 * over it, and the looping motion clip. Progressive enhancement — the
 * YouTube header stays underneath when Apple has nothing for the artist.
 */
app.get('/api/apple-artist', async (c) => {
  const name = String(c.req.query('name') || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const empty = { hero: null, logo: null, motion: null, wideMotion: null, preview: null, widePreview: null };
  try {
    // Apple is progressive artwork. Keep the YouTube banner responsive while
    // its uncached page lookup continues and fills the server cache.
    const art = await withTimeout(artistArt(name), 4_500, undefined);
    if (art === undefined) return c.json({ ...empty, transient: true });
    return c.json(art || empty);
  } catch (err) {
    console.warn('[apple] artist artwork request failed:', err?.message || err);
    // Don't turn an optional Apple enhancement into a failing artist page.
    return c.json({ ...empty, transient: true });
  }
});

/** Extra HD pictures of an artist, for the slideshow when Apple has no clip. */
app.get('/api/artist-images', async (c) => {
  const name = String(c.req.query('name') || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const images = await withTimeout(artistImages(name), 5_000, []);
  return c.json({ images: images || [] });
});

/** Apple album motion for the full-screen player; null is a normal no-canvas result. */
app.get('/api/apple-motion', async (c) => {
  const title = String(c.req.query('title') || '').trim();
  const artist = String(c.req.query('artist') || '').trim();
  const album = String(c.req.query('album') || '').trim();
  if (!title || !artist) return c.json({ error: 'title and artist required' }, 400);
  // Every credited artist ("a|b|c"), not just the first: a film song is filed under different names in different catalogues.
  const artists = [
    ...new Set(
      [...String(c.req.query('artists') || '').split('|'), ...artist.split(/,|&/)].map((a) => a.trim()).filter(Boolean),
    ),
  ];
  const [art, apple] = await Promise.all([
    trackMotionArt({ title, artist, album }).catch(() => null),
    trackMusicVideos({ title, artists, album }).catch(() => null),
  ]);
  const mvs = (apple || []).map(({ url, aspect, title: name, label, provider }) => ({ url, aspect, title: name, label, provider }));
  return c.json({ ...(art || { url: null, aspect: null }), mv: mvs[0] || null, mvs });
});

/** Song identity: canonical metadata + ISRC (iTunes × Deezer × lrc.red). */
app.get('/api/identify', async (c) => {
  const title = String(c.req.query('title') || '').trim();
  if (!title) return c.json({ error: 'title required' }, 400);
  const out = await identify({
    title,
    artist: String(c.req.query('artist') || '').trim(),
    duration: parseFloat(c.req.query('duration') || '0') > 0 ? parseFloat(c.req.query('duration') || '0') : undefined,
  });
  return c.json(out || { isrc: null, canonical: null, confidence: 0, sources: [] });
});

/* ---------------- lyrics (mounted in Phase 2) ---------------- */

try {
  const { registerLyricsRoutes } = await import('./lyrics/index.js');
  registerLyricsRoutes(app);
  console.log('[api] lyrics engine mounted');
} catch (err) {
  console.warn('[api] lyrics engine not available yet:', err.message);
}

/* ---------------- static frontend + SPA fallback ---------------- */

// An unknown API path is a 404 in JSON, never the HTML shell.
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

const DIST = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('\n  [!] No frontend build found. Run:  bun run build\n');
}

const { serveStatic, spaFallback } = await import('./static.js');
app.use('*', serveStatic(DIST));
app.get('*', spaFallback(DIST));

/* ---------------- warm start ---------------- */

const DATA_DIR = path.join(__dirname, '..', 'data');
const lyricCaches = (await import('./lyrics/index.js')).lyricsPersist();
// Not awaited: the site starts answering first; warm caches fill in behind it.
const warm = persistCaches(path.join(DATA_DIR, 'cache'), {
  ...lyricCaches,
  genre: genreCache.cache,
  genrePl: genrePlCache.cache,
  playlist: playlistCache.cache,
  charts: chartsCache.cache,
  home: homeCache.cache,
  artist: artistCache.cache,
  album: albumCache.cache,
  track: trackCache.cache,
});
warm.catch(() => {});

/* ---------------- boot ---------------- */

export { app };

// Deliberately no `export default { port, fetch }`: Bun auto-serves that, and
// the explicit Bun.serve below would then fail to bind the same port.

if (typeof Bun !== 'undefined') {
  const server = Bun.serve({
    port: PORT,
    fetch: app.fetch,
    // Keep-alive a little longer than the default: the browser reuses
    // connections for the asset and API calls that follow a navigation.
    idleTimeout: 60,
    development: false,
  });
  console.log(`\n  VYUNE ▶ http://localhost:${server.port}  (Bun + Hono, Solid build)\n`);
} else {
  // Node fallback, for a machine without Bun. Same Hono app, same routes.
  const { createServer } = await import('node:http');
  const { Readable } = await import('node:stream');
  createServer(async (req, res) => {
    const origin = `http://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url || '/', origin);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v != null) headers.set(k, String(v));
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody ? await new Response(Readable.toWeb(req)).arrayBuffer() : undefined;
    const response = await app.fetch(new Request(url, { method: req.method, headers, body, duplex: 'half' }), {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }
    res.end();
  }).listen(PORT, () => {
    console.log(`\n  VYUNE ▶ http://localhost:${PORT}  (Node + Hono, Solid build)\n`);
  });
}

// Pre-warm the InnerTube session so first search is instant.
yt.getYT().then(() => {
  console.log('[yt] session ready');
  globalTopTracks(20).catch(() => {});
}).catch((e) => console.error('[yt] init failed:', e.message));
// Pre-warm Apple's catalog token too. It is the slow half of the artist
// banner lookup, and the token is good for months — fetching it now means
// the first artist page gets its banner immediately instead of waiting.
warmAppleCatalog().catch(() => {});

// Warm the pages everyone opens first immediately upon boot so the first visitor
// receives an instantaneous (<5ms) response from in-memory cache without waiting.
(async () => {
  try {
    const homeData = await homeCache.resolve('home', buildHome);
    const topPlaylists = (homeData?.curated?.rows || [])
      .flatMap((r) => r.items || [])
      .slice(0, 32);
    for (const item of topPlaylists) {
      if (item?.id) {
        playlistCache.warm(`pl1:${item.id}`, () => yt.getPlaylist(item.id, { pages: 0 }));
      }
    }
  } catch {}

  for (const route of ['/api/charts', '/api/genres']) {
    try {
      await app.fetch(new Request(`http://localhost${route}`));
    } catch {}
  }
})().catch(() => {});
