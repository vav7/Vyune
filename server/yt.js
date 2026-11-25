/**
 * yt.js — YouTube.js (InnerTube) wrapper.
 *
 * Single shared Innertube session, normalized Track DTOs, and helpers for:
 *  - music search (song-filtered → flat, popularity-ordered results)
 *  - search suggestions (autocomplete)
 *  - official Moods & Genres categories + their curated playlists
 *  - charts, playlists, up-next radio
 *  - stream URL resolution through YouTube.js, a multi-client cascade
 *    (WEB → ANDROID → IOS → TVHTML5 → MWEB), and bundled yt-dlp fallback.
 *
 * Everything upstream can fail; nothing here throws — callers get null/[].
 */

import { openStream } from './openstreams.js';
import { resolveDistubeAudioStream } from './videoStream.js';
import { Innertube, Platform, UniversalCache } from 'youtubei.js';
import { safeFetch, withTimeout } from './cache.js';
import { execFile as execute } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const execFile = promisify(execute);
const ytDirectory = path.dirname(fileURLToPath(import.meta.url));

function ytDlpExecutable() {
  const configured = process.env.YT_DLP_PATH?.trim();
  const configuredIsPath = !!configured && (path.isAbsolute(configured) || /[\\/]/.test(configured));
  if (configuredIsPath) return path.resolve(process.cwd(), configured);
  const bundled = [
    path.resolve(ytDirectory, '../.tools/yt-dlp.exe'),
    path.resolve(process.cwd(), '.tools/yt-dlp.exe'),
    path.resolve(process.cwd(), '../../.tools/yt-dlp.exe'),
  ].find(existsSync);
  return bundled || configured || 'yt-dlp';
}

/**
 * The search filter that asks YouTube Music for one kind of result.
 *
 * This is the whole trick to "the label's own recording, not somebody's
 * upload". With `musicSearchType.song` set, the answer is YouTube Music's
 * "Songs" shelf: the catalogue's own audio, filed under its title, its
 * credited artists and its album. Without it, the same query also answers
 * with the "Videos" shelf — which is nothing but other people's uploads:
 * lyric videos, slowed-and-reverbmed copies, hour-long loops, and tracks a
 * generator wrote from the song's name.
 *
 * Those were being harvested into the song results, and one of them was
 * what played.
 *
 * The filter is YouTube's own protobuf, base64'd into the `params`
 * argument — the same encoding YouTube.js and ytmusicapi send.
 */
const MUSIC_SEARCH_TYPES = new Set(['song', 'video', 'album', 'artist', 'playlist']);
let searchFilterProto = null;

async function searchParams(kind) {
  if (!MUSIC_SEARCH_TYPES.has(kind)) return undefined;
  try {
    if (!searchFilterProto) {
      // The protobuf lives inside the package but is not in its exports map,
      // so it is resolved by path rather than by name.
      const require = createRequire(import.meta.url);
      const pkg = require.resolve('youtubei.js/package.json');
      const file = path.join(path.dirname(pkg), 'dist/protos/generated/misc/params.js');
      searchFilterProto = await import(pathToFileURL(file).href);
    }
    const writer = searchFilterProto.SearchFilter.encode({
      filters: { musicSearchType: { [kind]: true } },
    });
    return encodeURIComponent(Buffer.from(writer.finish()).toString('base64'));
  } catch (err) {
    console.warn('[yt] search filter unavailable:', err.message);
    return undefined;
  }
}

let ytPromise = null;

export function getYT() {
  if (!ytPromise) {
    // youtubei.js needs the page's signature/n-parameter functions evaluated
    // before deciphered audio URLs are playable. Without this evaluator
    // this cascade finds formats but
    // silently discards every encrypted URL.
    Platform.shim.eval = async (data, env) => {
      const properties = [];
      if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
      if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
      return new Function(`${data.output}\nreturn { ${properties.join(', ')} }`)();
    };
    ytPromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true,
      location: process.env.YT_LOCATION || 'US',
      ...(process.env.YT_COOKIE ? { cookie: process.env.YT_COOKIE } : {}),
    }).catch(async (err) => {
      console.warn('[yt] Innertube create with player failed, falling back to basic session:', err?.message || err);
      return Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true,
        retrieve_player: false,
        location: process.env.YT_LOCATION || 'US',
        ...(process.env.YT_COOKIE ? { cookie: process.env.YT_COOKIE } : {}),
      }).catch((innerErr) => {
        ytPromise = null;
        throw innerErr;
      });
    });
  }
  return ytPromise;
}

/* ------------------------------------------------------------------ */
/* Normalized DTOs                                                     */
/* ------------------------------------------------------------------ */

/** Bump googleusercontent/ggpht art URLs to 1080px. They arrive at 60-544px
 *  with a zoo of suffix formats (=s60-c, =w120-h120-l90-rj, ?w=544 …). */
export function hiRes(url) {
  if (!url) return url;
  const u = String(url);
  if (/\.(googleusercontent|ggpht)\.com/.test(u)) {
    const base = u.split(/[=?]/)[0];
    return `${base}=w1080-h1080-l90-rj`;
  }
  return u
    .replace(/([?&])w=\d+/, '$1w=1080')
    .replace(/=w\d+-h\d+(-[a-z0-9-]+)?$/, '=w1080-h1080$1')
    .replace(/-w\d+-h\d+(-l90-rj)?$/, '-w1080-h1080$1');
}

export function pickThumb(thumbs, want = 'high') {
  if (!thumbs?.length) return null;
  const byW = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
  if (want === 'low') return byW[byW.length - 1].url;
  // For music releases and tracks, square (1:1) is the official release artwork; prefer it if present
  const squares = byW.filter((t) => t.width && t.height && Math.abs(t.width - t.height) / t.width < 0.15);
  const picked = (squares[0] || byW[0]).url;
  return hiRes(picked);
}

/** Artist headers have landscape channel art; never run it through square hiRes(). */
function pickArtistBanner(thumbs) {
  const landscape = (thumbs || [])
    .filter((t) => t?.url && t.width > 0 && t.height > 0 && t.width / t.height >= 1.5)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const source = landscape[0];
  if (!source) return null;

  // Ask YouTube's image CDN for a 1920px version at the source's native ratio.
  // The old hiRes() helper always requested 1080x1080, cropping channel art.
  if (/\.(?:googleusercontent|ggpht)\.com/i.test(source.url)) {
    const height = Math.round(1920 / (source.width / source.height));
    return `${source.url.split(/[=?]/)[0]}=w1920-h${height}-l90-rj`;
  }
  return source.url;
}

/**
 * Whether a row is the catalogue's own audio ("Song") or somebody's upload
 * ("Video").
 *
 * The distinction decides what may be PLAYED. A catalogue row is the label's
 * own recording, filed under the title, the artists and the album — it is the
 * right recording by construction. An upload is somebody's copy of something:
 * a cover, a live cut, a remix, an hour-long loop, or a track a generator
 * wrote from the song's name. Playing it is how the wrong song gets played,
 * so these are handed to the catalogue matcher instead (see /api/stream).
 */
function rowTypeText(item) {
  const cols = item?.fixed_columns || item?.fixedColumns || [];
  const type = cols[1]?.title?.text || cols[1]?.title?.runs?.map((r) => r.text).join('') || '';
  return String(type).trim().toLowerCase();
}

const ARTIST_TYPE_WORDS = new Set(['song', 'video', 'episode', 'single', 'album', 'ep', 'playlist', 'artist', 'podcast', 'profile']);

export const normKey = (s = '') => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

export function isNotArtist(part) {
  if (!part || typeof part !== 'string') return true;
  const s = part.trim();
  if (!s) return true;
  if (ARTIST_TYPE_WORDS.has(s.toLowerCase())) return true;
  if (/\b\d{1,2}(?::\d{2}){1,2}\b/.test(s)) return true;
  if (/\b(?:plays?|views?|listeners?|subscribers?|streams?|monthly|audience|crore|cr|lakh)\b/i.test(s)) return true;
  if (/^[\d.,\s]+[kmb]?$/i.test(s)) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s*\d{4}$/i.test(s)) return true;
  if (/^\d{4}$/.test(s)) return true;
  if (/^[•·|,&/–—\s\-:]+$/.test(s)) return true;
  return false;
}

/**
 * Clean and separate song title and artist.
 * Handles patterns like "Artist - Title", "Artist – Title", "Artist : Title".
 * If title starts with Artist, separates them so title is strictly the song name.
 */
export function parseTitleAndArtist(rawTitle, rawArtists = [], channel = null) {
  let title = String(rawTitle || '').trim();
  let artists = (Array.isArray(rawArtists) ? rawArtists : [])
    .map((a) => (typeof a === 'string' ? a : a?.name || a?.text || ''))
    .filter((a) => a && !isNotArtist(a));

  const dashMatch = title.match(/^([^–—\-:|]+)\s*[-–—:|]\s*(.+)$/);
  if (dashMatch) {
    const prefix = dashMatch[1].trim();
    const suffix = dashMatch[2].trim();
    const prefixNorm = prefix.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const hasArtistMatch = artists.some((a) => String(a || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === prefixNorm);
    const channelNorm = String(channel || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const channelMatch = channelNorm && (channelNorm.includes(prefixNorm) || prefixNorm.includes(channelNorm));
    const isVersionSuffix = /^(live|remix|acoustic|instrumental|version|edit|mix|slowed|sped up|karaoke|official)\b/i.test(suffix);

    if (!isVersionSuffix && (hasArtistMatch || channelMatch || artists.length === 0)) {
      if (!artists.length && prefix && !isNotArtist(prefix)) {
        artists.push(prefix);
      }
      title = suffix;
    }
  }

  return { title, artists };
}

/** Normalize any music item (search/playlist/home) into the Track DTO. */
export function mapTrack(item, fallbackArtist) {
  if (!item) return null;
  const id = item.id;
  if (!id) return null;
  const artistObjs = item.artists || item.authors || [];
  let artists = artistObjs.map((a) => a?.name).filter((n) => n && !isNotArtist(n));
  if (!artists.length && fallbackArtist && !isNotArtist(fallbackArtist)) artists.push(fallbackArtist);
  const artistIds = artistObjs.map((a) => a?.id || a?.channel_id).filter(Boolean);
  const rawTitle = typeof item.title === 'string' ? item.title : item.title?.text || '';
  const channel = item.author?.name || item.author || null;
  const parsed = parseTitleAndArtist(rawTitle, artists, typeof channel === 'string' ? channel : null);
  const title = parsed.title;
  artists = parsed.artists.filter((a) => !isNotArtist(a));
  const durSec =
    typeof item.duration === 'number'
      ? item.duration
      : parseDuration(
          item.duration?.text ||
            item.duration ||
            item.fixed_columns?.[0]?.title?.text ||
            item.fixed_columns?.[0]?.title?.toString?.() ||
            item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text,
        );
  const type = rowTypeText(item);
  return {
    id,
    source: 'yt',
    title,
    artists,
    artistIds,
    album: item.album?.name || item.album?.text || null,
    albumId: item.album?.id || null,
    duration: durSec || 0,
    thumb: pickThumb(item.thumbnails),
    explicit: !!item.is_explicit,
    channel: typeof channel === 'string' ? channel : null,
    // No type column means the row is not a video — treat it as catalogue.
    isUpload: type ? type.includes('video') : false,
  };
}

/**
 * What kind of page a browse id opens.
 *
 * The card needs to say so: a card whose kind is missing is assumed to be a
 * playlist, and an artist row sent to the playlist page answers 404.
 */
export function kindForBrowseId(id = '') {
  const s = String(id);
  if (s.startsWith('UC')) return 'artist';
  if (s.startsWith('MPRE')) return 'album';
  if (s.startsWith('VLRD') || s.startsWith('RD')) return 'radio';
  if (s.startsWith('VLPL') || s.startsWith('PL')) return 'playlist';
  if (s.startsWith('VL')) return 'playlist';
  return null;
}

/** Card DTO for two-row items (albums/playlists/artists/videos). */
export function mapCard(item) {
  if (!item) return null;
  const title = typeof item.title === 'string' ? item.title : item.title?.text;
  const id = item.id || item.title?.runs?.[0]?.endpoint?.payload?.browseId;
  if (!id || !title) return null;
  const subtitle =
    typeof item.subtitle === 'string'
      ? item.subtitle
      : item.subtitle?.text || (item.subtitle?.runs || []).map((r) => r.text).join(' • ');
  const year = ((subtitle || '').match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
  const type = /\bsingle\b/i.test(subtitle || '')
    ? 'Single'
    : /\bep\b/i.test(subtitle || '')
      ? 'EP'
      : /\balbum\b/i.test(subtitle || '')
        ? 'Album'
        : null;
  return {
    id,
    title,
    subtitle: subtitle || null,
    thumb: pickThumb(item.thumbnails),
    year: year ? parseInt(year, 10) : null,
    type,
    // The kind decides where the card goes, so it is worked out from the
    // browse id when the caller does not already know it.
    kind: item.kind || kindForBrowseId(id),
  };
}

export function parseDuration(text) {
  if (typeof text === 'number') return text;
  if (!text || typeof text !== 'string') return 0;
  const parts = text.split(':').map((n) => parseInt(n, 10));
  if (parts.some(isNaN)) return 0;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Song-filtered YT Music search → flat array of Tracks,
 * already ordered by YouTube's own relevance/popularity.
 *
 * The filter is what keeps the answer to the catalogue: only the "Songs"
 * shelf — the label's own audio, filed with its credited artists and its
 * album. The unfiltered answer is never harvested, because it also carries
 * the "Videos" shelf: other people's uploads, which is where the covers,
 * the slowed copies and the generated slop come from.
 */
export async function searchSongs(query, limit = 25) {
  try {
    const yt = await getYT();
    const res = await withTimeout(yt.music.search(query, { type: 'song' }), 7000, null);
    if (res) {
      const shelf = res.contents?.[0];
      const items = (shelf?.contents || shelf?.items || []).filter(
        (i) => i.type === 'MusicResponsiveListItem' && i.id && i.item_type !== 'video',
      );
      const isStudio = (t) => !/(?:live|concert|tour|stage|performance|rehearsal|skit|dialogue|scene|reaction|cover)/i.test(t.title);
      const tracks = items
        .map(mapTrack)
        .filter((track) => track && !track.isUpload)
        .sort((a, b) => Number(isStudio(b)) - Number(isStudio(a)));
      if (tracks.length) return tracks.slice(0, limit);
    }
    const raw = await rawSearchSongs(query, limit);
    return raw.tracks;
  } catch (err) {
    console.error('[yt] search failed:', err.message);
    const raw = await rawSearchSongs(query, limit);
    return raw.tracks;
  }
}

function dedupById(tracks) {
  const seen = new Set();
  return tracks.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
}

/**
 * The catalogue's own songs for a query, on the raw renderer walk.
 *
 * The songs filter is what makes this the catalogue: the answer is the
 * "Songs" shelf — the label's own audio, with its credited artists and its
 * album — and never the "Videos" shelf of other people's uploads.
 *
 * Crash-proof by construction: youtubei.js' parsed classes throw on
 * YouTube's newest node types, and the hand-mapped walk does not care what
 * shape the node has.
 */
export async function rawSearchSongs(query, limit = 25) {
  try {
    const yt = await getYT();
    const params = await searchParams('song');
    const resp = await withTimeout(
      yt.actions.execute('/search', {
        query,
        ...(params ? { params } : {}),
        client: 'YTMUSIC',
      }),
      4000,
      null,
    );
    if (!resp?.data) return { tracks: [], corrected: null, unavailable: true };

    const srf = collectRenderers(resp.data, 'showingResultsForRenderer')[0];
    const corrected =
      srf?.correctedQuery?.runs?.map((r) => r.text).join('') ||
      srf?.correctedQuery?.simpleText ||
      null;

    const tracks = [];
    const shelves = collectRenderers(resp.data, 'musicShelfRenderer');
    for (const shelf of shelves) {
      for (const c of shelf.contents || []) {
        const row = c.musicResponsiveListItemRenderer;
        if (!row) continue;
        const t = mapRawListItem(row);
        if (t && !t.isUpload) tracks.push(t);
        if (tracks.length >= limit) break;
      }
      if (tracks.length >= limit) break;
      // A long shelf is paged: follow its continuation.
      const token =
        (shelf.contents || []).find((c) => c.continuationItemRenderer)
          ?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
        collectRenderers(shelf, 'musicShelfContinuationRenderer')[0]
          ?.continuationEndpoint?.continuationCommand?.token ||
        null;
      if (!token) continue;
      const more = await rawContinue(token);
      if (!more?.data) continue;
      for (const r of collectRenderers(more.data, 'musicResponsiveListItemRenderer')) {
        const t = mapRawListItem(r);
        if (t && !t.isUpload) tracks.push(t);
        if (tracks.length >= limit) break;
      }
    }

    if (tracks.length) return { tracks: dedupById(tracks).slice(0, limit), corrected };

    // The filter came up empty — the unfiltered answer is the fallback, and
    // only its catalogue rows are taken.
    const loose = await withTimeout(
      yt.actions.execute('/search', { query, client: 'YTMUSIC' }),
      2500,
      null,
    ).catch(() => null);
    if (!loose?.data) return { tracks: [], corrected, unavailable: true };
    const looseTracks = [];
    for (const r of collectRenderers(loose?.data, 'musicResponsiveListItemRenderer')) {
      if (classifyRawRow(r) !== 'song') continue;
      const t = mapRawListItem(r);
      if (t && !t.isUpload) looseTracks.push(t);
      if (looseTracks.length >= limit) break;
    }
    if (looseTracks.length) return { tracks: dedupById(looseTracks).slice(0, limit), corrected };

    // A card shelf can point at a music video or an arbitrary upload. Do not
    // turn that into a playable song when the official Songs shelf is empty.
    return { tracks: [], corrected, unavailable: false };
  } catch (err) {
    console.error('[yt] rawSearchSongs failed:', err.message);
    return { tracks: [], corrected: null, unavailable: true };
  }
}

/** What is this raw list row? song / video / album / artist / playlist */
function browsePageType(nav = {}) {
  return String(
    nav?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ||
      nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ||
      '',
  ).toUpperCase();
}

/**
 * The music videos for a song.
 *
 * YouTube Music's own "Video" shelf is not reachable through the typed
 * search — the video rows sit in the unfiltered answer, and the only thing
 * that marks them is the byline, which opens with the kind:
 *
 *   "Video • Arijit Singh • 194M views"
 *
 * The song rows open with "Song", the artist rows with "Artist", and so on.
 * That prefix is what this reads.
 */
export async function searchVideos(query, limit = 12) {
  try {
    const yt = await getYT();
    const resp = await withTimeout(
      yt.actions.execute('/search', { query, client: 'YTMUSIC' }),
      4_000,
      null,
    ).catch(() => null);
    if (!resp?.data) return [];
    const out = [];
    for (const r of collectRenderers(resp.data, 'musicResponsiveListItemRenderer')) {
      const byline = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
        .map((x) => x.text)
        .join('');
      if (!/^video\b/i.test(byline.trim())) continue;
      const track = mapRawListItem(r);
      if (!track?.id || !track.title) continue;
      out.push({ ...track, kind: 'video', channel: byline });
      if (out.length >= limit) break;
    }
    return dedupById(out);
  } catch (err) {
    console.error('[yt] searchVideos failed:', err.message);
    return [];
  }
}

export function classifyRawRow(r) {
  const endpoints = [
    r.navigationEndpoint,
    ...(r.flexColumns || []).flatMap((c) =>
      (c.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map((run) => run.navigationEndpoint),
    ),
  ].filter(Boolean);
  for (const nav of endpoints) {
    const be = nav.browseEndpoint || nav;
    const pageType = browsePageType(nav);
    if (pageType.includes('ARTIST') || be?.browseId?.startsWith('UC')) return 'artist';
    // An album can carry a playlist playback endpoint as well as its browse
    // endpoint. Check the catalogue page type/id before the playback route.
    if (pageType.includes('ALBUM') || be?.browseId?.startsWith('MPRE')) return 'album';
    if (pageType.includes('PLAYLIST') || nav.watchPlaylistEndpoint || nav.watchEndpoint?.playlistId || /^(VL)?(?:PL|UU|RD)/.test(be?.browseId || '')) return 'playlist';
  }
  if (r.playlistItemData?.videoId) return 'song';
  if (r.navigationEndpoint?.watchEndpoint?.videoId) {
    const sub = ((r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || [])
      .map((x) => x.text)
      .join('')
      .toLowerCase();
    return sub.includes('view') ? 'video' : 'song';
  }
  return 'song';
}

function rawTwoRowId(r) {
  const nav = r?.title?.runs?.[0]?.navigationEndpoint || r?.navigationEndpoint || {};
  return nav.browseEndpoint?.browseId || nav.browseId || nav.watchPlaylistEndpoint?.playlistId ||
    nav.watchEndpoint?.playlistId || nav.watchEndpoint?.videoId || null;
}

function rawTwoRowThumbnails(r) {
  return (
    r?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    r?.thumbnailRenderer?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
    r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    r?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
    r?.thumbnail?.thumbnails ||
    r?.thumbnails ||
    []
  );
}

export function classifyRawTwoRow(r) {
  const nav = r.title?.runs?.[0]?.navigationEndpoint || r.navigationEndpoint || {};
  const be = nav.browseEndpoint || nav;
  const pageType = browsePageType(nav);
  if (pageType.includes('ARTIST')) return 'artist';
  if (pageType.includes('ALBUM') || be?.browseId?.startsWith('MPRE')) return 'album';
  if (pageType.includes('PLAYLIST') || nav.watchPlaylistEndpoint || nav.watchEndpoint?.playlistId) return 'playlist';
  if (be?.browseId?.startsWith('UC')) return 'artist';
  if (/^(VL)?(?:PL|UU|RD)/.test(be?.browseId || '')) return 'playlist';
  if (r.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint) return 'video';
  return 'album';
}

/* ------------------------------------------------------------------ */
/* Artist & Album pages (music-player parity discography)              */
/* ------------------------------------------------------------------ */

/**
 * Give the tracks that arrived without a length one.
 *
 * An artist's "Top songs" shelf omits the runtime — the rows carry only a
 * title, a credit and a play count. A zero-length track cannot be matched
 * against the catalogue, so the stream resolver never finds it and the song
 * appears broken. YouTube answers the length for a video in a single small
 * request, and a handful of them go out at once.
 */
async function fillMissingDurations(tracks) {
  const missing = tracks.filter((t) => !t.duration && t.id);
  if (!missing.length) return;
  try {
    const yt = await getYT();
    await Promise.all(
      missing.map(async (track) => {
        try {
          const info = await yt.getBasicInfo(track.id);
          const seconds = Number(info?.basic_info?.duration);
          if (Number.isFinite(seconds) && seconds > 0) track.duration = seconds;
        } catch {
          // A video that will not answer keeps its zero length; the matcher
          // falls back to title and credit for those.
        }
      }),
    );
  } catch {
    // No session, no lengths. The page is still worth showing.
  }
}

export async function getArtistPage(artistId) {
  // RAW renderer walk on purpose: youtubei.js' runtime class generator throws on
  // YouTube's newest node types; hand-mapping keeps artist pages crash-proof.
  try {
    const yt = await getYT();
    const resp = await rawBrowse(artistId);
    // rawBrowse intentionally returns null when InnerTube times out. A failed
    // fetch is a recoverable miss, not a malformed artist response.
    if (!resp?.data) return null;
    const data = resp.data;

    /* header */
    let name = '';
    let desc = null;
    let thumb = null;
    let subscribers = null;
    let listeners = null;
    const heads = collectRenderers(data, 'musicImmersiveHeaderRenderer').concat(
      collectRenderers(data, 'musicResponsiveHeaderRenderer'),
    );
    const h = heads[0];
    if (h) {
      name = h.title?.runs?.[0]?.text || h.title?.text || '';
      desc = (h.description?.runs || []).map((r) => r.text).join('') || h.description?.text || null;
      thumb = pickArtistBanner(
        h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
          h.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
          h.thumbnail?.contents ||
          [],
      );
      const mlc = h.monthlyListenerCount;
      const sbCount =
      h.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs?.[0]?.text ||
      h.subscriptionButton?.subscriberCount?.text ||
      h.subscription_button?.subscriber_count?.text;
      listeners = (mlc?.runs?.[0]?.text || mlc?.text || mlc?.simpleText || '')
        .replace(/\s*monthly audience\s*$/i, '') || null;
      subscribers = sbCount ? String(sbCount).replace(/\s*subscribers?\s*$/i, '') : null;
    }

    if (!desc) {
      const about = collectRenderers(data, 'musicDescriptionShelfRenderer')[0];
      desc =
        (about?.description?.runs || []).map((r) => r.text).join('') ||
        about?.description?.text ||
        null;
    }

    const page = {
      id: artistId,
      name: name || 'Artist',
      description: desc,
      subscribers,
      listeners,
      thumb,
      topSongs: [],
      sections: [],
      similar: [],
      discography: [],
    };

    const discoEndpoints = {};
    const discoSeed = []; // visible carousel rows (fallback + merge source)

    /* shelves → top songs */
    for (const shelf of collectRenderers(data, 'musicShelfRenderer')) {
      const title = shelf.title?.runs?.[0]?.text || '';
      const isArtistSongsShelf = /song|track/i.test(title);
      const rows = (shelf.contents || [])
        .map((c) => c.musicResponsiveListItemRenderer)
        .filter(Boolean)
        .map(mapRawListItem)
        // A linked artist Songs shelf is already the catalogue's own track
        // list. Some rows omit album metadata, which otherwise mislabels them
        // as uploads and triggers a failed catalogue rematch during playback.
        .map((track) =>
          track && isArtistSongsShelf && !/video/i.test(track.type || '') && track.artistIds?.includes(artistId)
            ? { ...track, isUpload: false }
            : track,
        )
        .filter(Boolean);
      if (/song|track/i.test(title) || (!page.topSongs.length && rows.length)) {
        page.topSongs = page.topSongs.concat(rows);
        // Artist pages often expose only the first five tracks and put the
        // rest behind the Songs shelf continuation. Follow a small number of
        // pages so the artist's Top Songs shelf has enough real catalog tracks
        // to browse and autoplay, without crawling the whole channel.
        let token =
          (shelf.contents || []).find((c) => c.continuationItemRenderer)
            ?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
          collectRenderers(shelf, 'continuationItemRenderer')[0]
            ?.continuationEndpoint?.continuationCommand?.token ||
          null;
        for (let pageNo = 0; token && pageNo < 3 && page.topSongs.length < 25; pageNo++) {
          const more = await withTimeout(
            yt.actions.execute('/browse', { continuation: token, client: 'YTMUSIC', parse: false }),
            4500,
            null,
          );
          if (!more?.data) break;
          const extraRows = collectRenderers(more.data, 'musicResponsiveListItemRenderer')
            .map(mapRawListItem)
            .filter((track) => track && (!isArtistSongsShelf || !/video/i.test(track.type || '')))
            .map((track) =>
              isArtistSongsShelf && track.artistIds?.includes(artistId)
                ? { ...track, isUpload: false }
                : track,
            );
          page.topSongs.push(...extraRows);
          token = collectRenderers(more.data, 'continuationItemRenderer')[0]
            ?.continuationEndpoint?.continuationCommand?.token || null;
        }
      }
    }

    // Artist shelves can contain fan uploads and music videos alongside the
    // catalogue rows. Keep the official album-backed recordings first.
    const orderedTopSongs = dedupById(page.topSongs).sort((a, b) => Number(!!a.isUpload) - Number(!!b.isUpload));
    const officialTopSongs = orderedTopSongs.filter((track) => !track.isUpload);
    // Keep fan uploads out of the primary shelf when the artist has linked
    // catalogue songs. If the upstream page has no catalogue rows at all,
    // retain only a few playable fallbacks rather than returning an empty shelf.
    page.topSongs = officialTopSongs.length ? officialTopSongs : orderedTopSongs.slice(0, 3);

    // The artist's "Top songs" shelf carries no runtime of its own — the rows
    // are title, credit and play count, with the album and the length left
    // out. A track with no length cannot be matched against the catalogue,
    // so it is fetched here, in parallel, for the handful of rows the page
    // shows. Without this every artist song arrives as a zero-length upload.
    await fillMissingDurations(page.topSongs);

    /* carousels → sections / similar / discography endpoints */
    for (const car of collectRenderers(data, 'musicCarouselShelfRenderer')) {
      const header = car.header?.musicCarouselShelfBasicHeaderRenderer || {};
      const title = header.title?.runs?.[0]?.text || '';
      const tl = title.toLowerCase();
      const headerEp = header.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
      if (headerEp?.browseId?.startsWith('MPAD')) {
        if (/albums/.test(tl)) discoEndpoints.albums = headerEp;
        else if (/singles|eps/.test(tl)) discoEndpoints.singles = headerEp;
      }
      const items = (car.contents || [])
        .map((c) => c.musicTwoRowItemRenderer)
        .filter(Boolean)
        .map((r) =>
          mapCard({
            id: rawTwoRowId(r),
            title: r.title?.runs?.[0]?.text,
            subtitle: { runs: r.subtitle?.runs || [], text: (r.subtitle?.runs || []).map((x) => x.text).join('') },
            thumbnails: rawTwoRowThumbnails(r),
            kind: classifyRawTwoRow(r),
          }),
        )
        .filter(Boolean);
      if (/^albums?$/.test(tl)) discoSeed.push(...items.map((c) => ({ ...c, type: c.type || 'Album' })));
      else if (/singles|eps/.test(tl)) discoSeed.push(...items.map((c) => ({ ...c, type: c.type || 'Single' })));
      if (!items.length) continue;
      if (/fans might also like|similar/.test(tl)) {
        page.similar = items;
        continue;
      }
      if (/^albums?$|singles/.test(tl)) continue; // superseded by discography
      if (/video|live|performance/.test(tl)) continue; // music-only surfaces
      // Artist pages should lead with the catalogue's songs and releases.
      // User-made playlists and radio mixes belong in their own destinations.
      const artistItems = items.filter((item) => item.kind !== 'playlist' && item.kind !== 'radio');
      if (artistItems.length) page.sections.push({ title: title || 'More', items: artistItems });
    }

    /* Full discography via MPAD browse. The params are universal across
       artists, so when a header carries no endpoint (Dr. Dre etc.) we
       synthesize MPAD<artistId> ourselves. Plus one continuation page. */
    const MPAD = {
      albums: discoEndpoints.albums || { browseId: 'MPAD' + artistId, params: 'ggMIegYIARoCAQI=' },
      singles: discoEndpoints.singles || { browseId: 'MPAD' + artistId, params: 'ggMIegYIAhoCAQI=' },
    };
    if (discoSeed.length >= 12 && !discoEndpoints.albums && !discoEndpoints.singles) {
      // The artist page already supplied a full release shelf. Reusing that
      // catalogue data avoids two extra Browse calls on the common path.
      page.discography = dedupById(discoSeed).sort((a, b) => (b.year || 0) - (a.year || 0));
    } else try {
      const fetchDisco = async (payload, kind) => {
        const tokenOf = (data) => {
          const continuation = collectRenderers(data, 'continuationItemRenderer')[0];
          return (
            continuation?.continuationEndpoint?.continuationCommand?.token ||
            continuation?.continuationEndpoint?.browseEndpoint?.continuation ||
            continuation?.continuationEndpoint?.continuationCommand?.continuation
          );
        };
        // One retry on a slow first answer, then follow the continuations: a
        // long catalogue must not stop at its first dozen releases.
        let r2 = await withTimeout(
          yt.actions.execute('/browse', { browseId: payload.browseId, params: payload.params, client: 'YTMUSIC', parse: false }),
          9000,
          null,
        );
        if (!r2) {
          r2 = await withTimeout(
            yt.actions.execute('/browse', { browseId: payload.browseId, params: payload.params, client: 'YTMUSIC', parse: false }),
            7000,
            null,
          );
        }
        if (!r2) return [];
        const rows = mapTwoRowItems(r2.data).map((c) => ({ ...c, type: c.type || kind }));
        let token = tokenOf(r2.data);
        for (let pageNo = 0; token && pageNo < 6 && rows.length < 150; pageNo++) {
          const more = await withTimeout(
            yt.actions.execute('/browse', { continuation: token, client: 'YTMUSIC', parse: false }),
            6000,
            null,
          );
          if (!more) break;
          rows.push(...mapTwoRowItems(more.data).map((c) => ({ ...c, type: c.type || kind })));
          token = tokenOf(more.data);
        }
        return rows;
      };
      const [albums, singles] = await Promise.all([
        fetchDisco(MPAD.albums, 'Album'),
        fetchDisco(MPAD.singles, 'Single'),
      ]);
      const seen = new Set();
      page.discography = [...albums, ...singles, ...discoSeed]
        .filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
        .sort((a, b) => (b.year || 0) - (a.year || 0));
    } catch (err) {
      console.error('[yt] discography browse failed:', err.message);
      const seen = new Set();
      page.discography = discoSeed.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
    }

    if (!page.description && page.name && page.name !== 'Artist') page.description = await wikipediaBio(page.name);
    try {
      page.radioId = null;
    } catch {}
    return page;
  } catch (err) {
    console.error('[yt] artist page failed:', err.message);
    return null;
  }
}

/** A short biography from Wikipedia when YouTube Music has none; only accepted if it is plainly a musician. */
async function wikipediaBio(name) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/\s+/g, '_'))}`, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      });
      if (!resp.ok) return null;
      const body = await resp.json();
      const text = String(body?.extract || '').trim();
      const looksMusical = /\b(singer|musician|rapper|band|composer|songwriter|producer|dj|vocalist|guitarist|pianist|group|duo)\b/i.test(`${body?.description || ''} ${text.slice(0, 240)}`);
      return text && looksMusical && body?.type !== 'disambiguation' ? text : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function getAlbumPage(albumId) {
  try {
    const yt = await getYT();
    const alb = await withTimeout(yt.music.getAlbum(albumId), 5000, null).catch(() => null);
    if (alb) {
      const parsed = mapAlbumPage(alb, albumId);
      // The typed parser sometimes returns a header with no parsed tracks for
      // new renderer variants. Treat that as a partial response and try raw
      // InnerTube JSON before the route turns a valid release into an empty
      // album page.
      if (parsed?.tracks?.length) return parsed;
    }

    // The parsed album classes can reject newer InnerTube renderer nodes.
    // Browse the same album as raw JSON so a parser change doesn't turn every
    // release after the first search result into a 404.
    const raw = await rawBrowse(albumId);
    if (!raw?.data) return null;
    const h =
      collectRenderers(raw.data, 'musicDetailHeaderRenderer')[0] ||
      collectRenderers(raw.data, 'musicResponsiveHeaderRenderer')[0] ||
      collectRenderers(raw.data, 'musicImmersiveHeaderRenderer')[0] ||
      {};
    const shelf =
      collectRenderers(raw.data, 'musicPlaylistShelfRenderer')[0] ||
      collectRenderers(raw.data, 'musicShelfRenderer')[0] ||
      {};
    const runs = h.subtitle?.runs || h.straplineTextOne?.runs || h.strapline_text_one?.runs || [];
    const authors = runs
      .filter((r) => {
        const nav = r.navigationEndpoint || r.endpoint || {};
        const id = nav.browseEndpoint?.browseId || nav.payload?.browseId;
        return id && (/^UC/.test(id) || browsePageType(nav).includes('ARTIST'));
      })
      .map((r) => {
        const nav = r.navigationEndpoint || r.endpoint || {};
        return { name: r.text, id: nav.browseEndpoint?.browseId || nav.payload?.browseId };
      });
    const title = runsText(h.title) || 'Album';
    const subtitleText = runsText(h.subtitle) || runsText(h.straplineTextOne) || runsText(h.strapline_text_one) || '';
    const thumb = pickThumb(
      h.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
        h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        h.thumbnail?.contents ||
        h.thumbnails ||
        [],
    );
    const rows = (shelf.contents || [])
      .map((entry) => entry.musicResponsiveListItemRenderer)
      .filter(Boolean);
    const artistName = authors[0]?.name || null;
    const tracks = rows
      .map((row, i) => {
        const t = mapRawListItem(row, artistName);
        if (!t) return null;
        t.trackNumber = i + 1;
        if (!t.thumb || /(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(t.thumb)) t.thumb = thumb;
        if (!t.album) t.album = title;
        if (!t.albumId) t.albumId = albumId;
        return t;
      })
      .filter(Boolean);
    if (!tracks.length) return null;
    const year = (subtitleText.match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
    return { id: albumId, title, subtitle: subtitleText || `${tracks.length} tracks`, year, thumb, artists: authors, tracks };
  } catch (err) {
    console.error('[yt] album page failed:', err.message);
    return null;
  }
}

function mapAlbumPage(alb, albumId) {
  const h = alb.header || {};
  const title = h.title?.text || h.title || 'Album';
  const subtitleText =
      h.subtitle?.text || (h.subtitle?.runs || []).map((r) => r.text).join(' • ') || '';
    // artists come as browse-endpoint runs inside the subtitle ("Album • Artist • 2023")
  const authors = (h.subtitle?.runs || [])
      .filter((r) => r.endpoint?.payload?.browseId && /^UC/.test(r.endpoint.payload.browseId))
      .map((r) => ({ name: r.text, id: r.endpoint.payload.browseId }));
  const year = (subtitleText.match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
  const thumb = pickThumb(
      h.thumbnail?.contents ||
        h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        h.thumbnails ||
        [],
    );
  const artistName = authors[0]?.name || h.strapline_text_one?.text || null;
  const tracks = (alb.contents || [])
      .map((it, i) => {
        const t = mapTrack(it, artistName);
        if (t) {
          t.trackNumber = i + 1;
          if (!t.thumb || /(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(t.thumb)) t.thumb = thumb;
          if (!t.album) t.album = title;
          if (!t.albumId) t.albumId = albumId;
        }
        return t;
      })
      .filter(Boolean);
  const secondSub =
      h.second_subtitle?.text || (h.second_subtitle?.runs || []).map((r) => r.text).join('') || '';
  const joined = `${subtitleText} ${secondSub}`;
  const subtitleBits = [
      subtitleText,
      secondSub && !subtitleText.includes(secondSub) ? secondSub : null,
      tracks.length && !joined.includes(String(tracks.length)) ? `${tracks.length} tracks` : null,
    ].filter(Boolean);
  return {
    id: albumId,
    title,
    subtitle: [...new Set(subtitleBits)].join(' • '),
    year,
    thumb,
    description: h.description?.text || null,
    artists: authors,
    tracks,
  };
}

/* ------------------------------------------------------------------ */
/* Genres / Moods (official YouTube Music categories)                  */
/* ------------------------------------------------------------------ */

async function rawBrowse(browseId, params) {
  const yt = await getYT();
  return withTimeout(yt.actions.execute('/browse', {
    browseId,
    ...(params ? { params } : {}),
    client: 'YTMUSIC',
    parse: false,
  }), 8000, null);
}

/** Collect every renderer of a type from a raw InnerTube response. */
export function collectRenderers(data, rendererKey, out = []) {
  if (Array.isArray(data)) {
    for (const v of data) collectRenderers(v, rendererKey, out);
    return out;
  }
  if (data && typeof data === 'object') {
    if (data[rendererKey]) out.push(data[rendererKey]);
    for (const k of Object.keys(data)) collectRenderers(data[k], rendererKey, out);
  }
  return out;
}

const runsText = (node) =>
  node?.runs?.map((r) => r.text).join('') || node?.simpleText || node?.text || '';

/** 32 official moods & genres categories (Chill, Party, Hip-hop, J-Pop…). */
export async function genreCategories() {
  const resp = await rawBrowse('FEmusic_moods_and_genres');
  // Keep transient InnerTube failures out of the resolver cache. The route
  // returns an empty DTO for this request, and the next request can retry.
  if (!resp?.data) return null;
  const btns = collectRenderers(resp.data, 'musicNavigationButtonRenderer');
  const seen = new Set();
  const cats = [];
  for (const b of btns) {
    const label = runsText(b.buttonText);
    const params = b.clickCommand?.browseEndpoint?.params;
    const labelKey = normTitleKey(label);
    if (!label || !params || seen.has(params) || seen.has(`label:${labelKey}`)) continue;
    seen.add(params);
    seen.add(`label:${labelKey}`);
    cats.push({ label, params });
  }
  return cats;
}

/** Curated official playlists inside one genre category (deduped — shelves
 *  on category pages repeat the same playlists across rows). */
export async function genrePlaylists(params) {
  const resp = await rawBrowse('FEmusic_moods_and_genres_category', params);
  if (!resp?.data) return null;
  const seenIds = new Set();
  const seenSignatures = new Set();
  const sections = [];
  const addSection = (title, candidates) => {
    const items = [];
    for (const p of candidates) {
      if (p.kind !== 'playlist') continue;
      const idKey = String(p.id || '').trim();
      // Playlist titles repeat across different curators. Use the credit line
      // with the title as a fallback identity, while exact browse IDs remain
      // authoritative for detecting repeated cards across shelves.
      const signature = `${normTitleKey(p.title)}:${normTitleKey(p.subtitle || '')}`;
      if ((idKey && seenIds.has(idKey)) || (signature !== ':' && seenSignatures.has(signature))) continue;
      if (idKey) seenIds.add(idKey);
      if (signature !== ':') seenSignatures.add(signature);
      items.push(p);
    }
    if (items.length) sections.push({ title: title || 'Playlists', items });
  };

  // Keep YouTube Music's own shelf labels, so a category page reads as a
  // curated set of groups instead of an undifferentiated wall of cards.
  for (const shelf of collectRenderers(resp.data, 'musicCarouselShelfRenderer')) {
    const header = shelf.header?.musicCarouselShelfBasicHeaderRenderer || {};
    const title = runsText(header.title);
    const cards = (shelf.contents || [])
      .map((entry) => entry.musicTwoRowItemRenderer)
      .filter(Boolean)
      .map((r) => mapCard({
        id: rawTwoRowId(r),
        title: runsText(r.title),
        subtitle: { runs: r.subtitle?.runs || [], text: runsText(r.subtitle) },
        thumbnails: r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails,
        kind: classifyRawTwoRow(r),
      }))
      .filter(Boolean);
    addSection(title, cards);
  }
  // Some categories return a flat layout rather than carousel shelves.
  if (!sections.length) addSection('Playlists', mapTwoRowItems(resp.data));
  return { items: sections.flatMap((section) => section.items), sections };
}

/** Combining marks are kept — they are the Devanagari vowel signs. */
const normTitleKey = (t = '') => String(t).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '').slice(0, 40);

/** Top charts: trending track list + chart playlists.
 *  Note: the charts browse page currently exposes a *Top artists* shelf plus
 *  chart playlist carousels — the trending TRACKS come from the primary
 *  chart playlist itself (cached alongside this response). */
export async function chartsContent() {
  const resp = await rawBrowse('FEmusic_charts');
  if (!resp?.data) return null;
  const data = resp.data;
  const playlists = mapTwoRowItems(data).filter((p) => p.kind === 'playlist').slice(0, 12);

  let tracks = [];
  const pick =
    playlists.find((p) => /top 100|trending|viral|top songs/i.test(p.title)) ||
    playlists[0];
  if (pick) {
    const pl = await getPlaylist(pick.id);
    tracks = pl?.tracks?.slice(0, 50) || [];
  }
  return { tracks, playlists };
}

/** Hand-mapped musicResponsiveListItemRenderer JSON → Track DTO. */
function mapRawListItem(r) {
  try {
    const flex = r.flexColumns || [];
    const col0 = flex[0]?.musicResponsiveListItemFlexColumnRenderer;
    const titleRuns = (col0?.text || col0?.title)?.runs || [];
    const rawTitle = titleRuns.map((x) => x.text).join('') || (col0?.text || col0?.title)?.text || '';
    if (!rawTitle) return null;
    const titleCol = titleRuns[0];
    const id =
      r.playlistItemData?.videoId ||
      r.navigationEndpoint?.watchEndpoint?.videoId ||
      titleCol?.navigationEndpoint?.watchEndpoint?.videoId ||
      r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
        ?.playNavigationEndpoint?.watchEndpoint?.videoId;
    if (!id) return null;
    const allCols = flex.slice(1);
    const subRuns = allCols.flatMap(
      (col) => (col?.musicResponsiveListItemFlexColumnRenderer?.text || col?.musicResponsiveListItemFlexColumnRenderer?.title)?.runs || []
    );
    const artists = [];
    const artistIds = [];
    const plain = [];
    let album = null;
    let albumId = null;
    for (const run of subRuns) {
      const bid = run.navigationEndpoint?.browseEndpoint?.browseId;
      const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.musicBrowseEndpointContextSupportedConfigs?.pageType || '';
      if (bid && (bid.startsWith('UC') || pageType.includes('ARTIST'))) {
        if (!isNotArtist(run.text)) {
          artists.push(run.text.trim());
          artistIds.push(bid);
        }
      } else if (bid && (bid.startsWith('MPRE') || bid.startsWith('FEmusic_library_album') || pageType.includes('ALBUM'))) {
        album = run.text;
        albumId = bid;
      } else if (run.text && !isNotArtist(run.text)) {
        // no browse endpoint: plain text — channel or album title
        plain.push(run.text.trim());
      }
    }
    // If no linked album was found, check if a 3rd flex column (flex[2]) has the album name
    if (!album && flex[2]) {
      const col2Runs = (flex[2]?.musicResponsiveListItemFlexColumnRenderer?.text || flex[2]?.musicResponsiveListItemFlexColumnRenderer?.title)?.runs || [];
      const col2Text = col2Runs.map((x) => x.text).join('').trim();
      if (col2Text && !isNotArtist(col2Text)) {
        album = col2Text;
      }
    }
    // Playlist rows carry their credit in the long byline instead of the
    // flex column; without this the rows came back with no artist at all.
    if (!artists.length) {
      for (const run of r.longBylineText?.runs || []) {
        const bid = run.navigationEndpoint?.browseEndpoint?.browseId;
        if (bid && bid.startsWith('UC') && !isNotArtist(run.text)) {
          artists.push(run.text.trim());
          artistIds.push(bid);
        } else if (run.text && !isNotArtist(run.text)) {
          plain.push(run.text.trim());
        }
      }
    }
    const durText =
      r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
    const typeCol =
      r.fixedColumns?.[1]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.map((x) => x.text).join('') ||
      '';
    const type = String(typeCol).trim().toLowerCase();
    const subText = plain
      .filter((part) => !isNotArtist(part))
      .join(' ')
      .trim();
    // When the fixed column is missing, the duration is often the trailing
    // m:ss in the byline (e.g. "Artist • 3:45" or "Artist • 4:23 • 1,234 views").
    const bylineText = (r.longBylineText?.runs || []).map((run) => run.text || '').join(' ');
    const durationSource = [bylineText, ...subRuns.map((run) => run.text || '')].join(' ');
    const durationMatches = [...durationSource.matchAll(/\b(\d{1,2}:\d{2})\b/g)];
    const durFromByline = durationMatches.at(-1)?.[1] || null;
    const effectiveDur = parseDuration(durText) ? durText : durFromByline;
    // The catalogue's own row is filed under a release — an album with its
    // own browse id — and carries no view count. Somebody's upload carries
    // neither: it is a lyric video, a slowed copy, a cover, or a track a
    // generator wrote from the song's name.
    const hasViews = /\bviews?\b/i.test(plain.join(' '));
    const isCatalogue = !!albumId;
    const parsed = parseTitleAndArtist(rawTitle, artists, subText);
    const title = parsed.title;
    if (!artists.length && parsed.artists.length) {
      artists.push(...parsed.artists.filter((a) => !isNotArtist(a)));
    }
    return {
      id,
      source: 'yt',
      title,
      artists: artists.filter((a) => !isNotArtist(a)),
      artistIds,
      album,
      albumId,
      duration: parseDuration(effectiveDur),
      thumb: pickThumb(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      explicit: false,
      channel: subText && !isNotArtist(subText) ? subText : null,
      // An upload, or a row the catalogue filed without a credited artist —
      // either way it is not the release, so the stream resolver sends it
      // through the catalogue matcher before it is ever played.
      isUpload: type.includes('video') || hasViews || !isCatalogue || artistIds.length === 0,
      type,
    };
  } catch {
    return null;
  }
}

function mapTwoRowItems(data) {
  const rows = collectRenderers(data, 'musicTwoRowItemRenderer');
  const out = [];
  for (const r of rows) {
    const titleRun = r.title?.runs?.[0];
    const id =
      titleRun?.navigationEndpoint?.browseEndpoint?.browseId ||
      titleRun?.navigationEndpoint?.watchPlaylistEndpoint?.playlistId ||
      titleRun?.navigationEndpoint?.watchEndpoint?.videoId ||
      r.navigationEndpoint?.browseEndpoint?.browseId ||
      r.navigationEndpoint?.watchPlaylistEndpoint?.playlistId ||
      r.navigationEndpoint?.watchEndpoint?.videoId;
    if (!id) continue;
    const isRadio = !!titleRun?.navigationEndpoint?.watchPlaylistEndpoint;
    const base = mapCard({
      id,
      title: titleRun.text,
      subtitle: { runs: r.subtitle?.runs || [], text: (r.subtitle?.runs || []).map((x) => x.text).join('') },
      thumbnails: r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails,
      kind: classifyRawTwoRow(r),
    });
    if (!base) continue;
    // mapCard already distinguishes albums (MPRE…), artists (UC…), and
    // playlists. Preserve that result; treating every two-row item as a
    // playlist makes discography album links route to the playlist endpoint.
    out.push({ ...base, kind: isRadio ? 'radio' : base.kind || 'playlist' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

/**
 * The browse id for a playlist. YouTube Music browses a playlist under
 * "VL" + its type letter + the rest of the id: "PLFgqu…" is browsed as
 * "VLPLFgqu…", a radio "RDAMVM…" as "VLRDAMVM…", a channel's uploads
 * "UU…" as "VLUU…".
 */
export function playlistBrowseId(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (s.startsWith('VL')) return s;
  if (s.startsWith('PL')) return `VLPL${s.slice(2)}`;
  if (s.startsWith('RD')) return `VLRD${s.slice(2)}`;
  if (s.startsWith('UU')) return `VLUU${s.slice(2)}`;
  return `VL${s}`;
}

/** The next page of a long list. */
async function rawContinue(token) {
  const yt = await getYT();
  return withTimeout(
    yt.actions.execute('/browse', { continuation: token, client: 'YTMUSIC' }),
    8000,
    null,
  );
}

/** The playlist's header: title, who made it, how many songs, the picture. */
function mapPlaylistHeader(renderer) {
  if (!renderer) return {};
  const title = runsText(renderer.title) || null;
  const subtitleRuns = renderer.subtitle?.runs || [];
  const secondRuns = renderer.secondSubtitle?.runs || [];
  const authorRun = subtitleRuns.find((r) =>
    r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'),
  );
  const author = authorRun?.text || null;
  const count =
    [...subtitleRuns, ...secondRuns]
      .map((r) => r.text)
      .join(' ')
      .match(/\b[\d.,]+\s+(?:songs?|tracks?)\b/i)?.[0] || null;
  const thumb = pickThumb(
    renderer.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
      renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      renderer.thumbnail?.thumbnails ||
      [],
  );
  return { title, author, count, thumb };
}

/**
 * A playlist, on the raw renderer walk.
 *
 * youtubei.js' parsed playlist classes throw on YouTube's newest node
 * types — the same reason the artist page is hand-mapped — and that throw
 * became an empty page: the handler caught it and answered 404, so the
 * playlist showed its shell and no tracks. The raw walk does not care what
 * shape the node has.
 */
export async function getPlaylist(playlistId, { pages: maxPages = 4 } = {}) {
  const browseId = playlistBrowseId(playlistId);
  if (!browseId) return null;
  try {
    const resp = await rawBrowse(browseId);
    if (!resp?.data) return null;

    const header = mapPlaylistHeader(
      collectRenderers(resp.data, 'musicResponsiveHeaderRenderer')[0] ||
        collectRenderers(resp.data, 'musicDetailHeaderRenderer')[0],
    );
    const shelf = collectRenderers(resp.data, 'musicPlaylistShelfRenderer')[0];
    // The shelf's contents are wrappers — { musicResponsiveListItemRenderer: … }
    // — so the renderer has to be taken out of its wrapper before it is read.
    let rows = (shelf?.contents || [])
      .map((c) => c.musicResponsiveListItemRenderer)
      .filter(Boolean);

    // A long playlist is paged: follow the continuation a few times, so the
    // list is the playlist and not its first screen.
    let token =
      (shelf?.contents || []).find((c) => c.continuationItemRenderer)
        ?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
    let pages = 0;
    while (token && pages < maxPages) {
      const more = await rawContinue(token);
      if (!more?.data) break;
      const moreRows = collectRenderers(more.data, 'musicResponsiveListItemRenderer');
      if (!moreRows.length) break;
      rows = rows.concat(moreRows);
      const moreShelf = collectRenderers(more.data, 'musicPlaylistShelfRenderer')[0];
      token =
        (moreShelf?.contents || []).find((c) => c.continuationItemRenderer)
          ?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
        collectRenderers(more.data, 'continuationItemRenderer')[0]
          ?.continuationEndpoint?.continuationCommand?.token ||
        null;
      pages++;
    }

    const tracks = rows.map((r) => mapRawListItem(r)).filter(Boolean);
    if (!tracks.length) return null;

    const subtitleBits = [header.author, header.count].filter(Boolean);
    return {
      id: playlistId,
      title: header.title || playlistId,
      subtitle: subtitleBits.length ? subtitleBits.join(' • ') : null,
      thumb: header.thumb || tracks[0]?.thumb || null,
      tracks,
      // true while more pages exist upstream that this answer has not fetched yet
      partial: !!token && pages >= maxPages,
    };
  } catch (err) {
    console.error('[yt] playlist failed:', err.message);
    return null;
  }
}

/** YouTube's own "start radio from this song" queue. */
export async function getRadio(videoId) {
  // Follow YouTube Music's own watch-next radio continuation using the Innertube
  // /next queue; each continuation is another batch of YouTube's actual suggested tracks.
  try {
    const yt = await getYT();
    let resp = await withTimeout(
      yt.actions.execute('/next', { videoId, client: 'YTMUSIC', parse: false }),
      8000,
      null,
    );
    const tracks = [];
    const seen = new Set([videoId]);
    let token = null;
    let playlistId = null;
    // Radio recommendations are delivered in small batches. Walk a bounded
    // number of pages so AutoPlay can keep a useful queue for longer songs.
    for (let pageNo = 0; resp?.data && pageNo < 5 && tracks.length < 50; pageNo++) {
      const data = resp.data;
      const panels = collectRenderers(data, 'playlistPanelVideoRenderer');
      for (const it of panels) {
          const id = it.videoId || it.endpoint?.payload?.videoId;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const artists = (it.longBylineText?.runs || [])
            .filter((r) => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC') && !isNotArtist(r.text))
            .map((r) => r.text.trim());
          const plain = (it.longBylineText?.runs || [])
            .map((r) => (r.text || '').trim())
            .filter((t) => t && !isNotArtist(t))
            .join(', ');
          const finalArtists = artists.length ? artists : (plain && !isNotArtist(plain) ? [plain] : []);
          tracks.push({
            id,
            source: 'yt',
            title: runsText(it.title),
            artists: finalArtists,
            album: null,
            duration: parseDuration(it.duration),
            thumb: pickThumb(it.thumbnail?.thumbnails),
            explicit: false,
          });
      }
      const continuation = collectRenderers(data, 'nextRadioContinuationData')[0];
      token = continuation?.continuation || null;
      const panel = collectRenderers(data, 'playlistPanelRenderer')[0];
      playlistId = panel?.playlistId || playlistId;
      // A continuation response may expose the token at the panel level.
      token ||= panel?.continuations?.[0]?.nextRadioContinuationData?.continuation ||
        panel?.continuations?.[0]?.nextContinuationData?.continuation || null;
      if (!token || tracks.length >= 50) break;
      resp = await withTimeout(
        yt.actions.execute('/next', {
          videoId,
          ...(playlistId ? { playlistId } : {}),
          continuation: token,
          client: 'YTMUSIC',
          parse: false,
        }),
        8000,
        null,
      );
    }
    const titled = tracks.filter((track) => track.title);
    if (titled.length) return titled;
  } catch {
    /* fall through to the parsed panel if InnerTube changes its payload */
  }
  try {
    const yt = await getYT();
    const up = await withTimeout(yt.music.getUpNext(videoId, true), 8000, null);
    if (!up) return [];
    const tracks = (up.contents || [])
      .map((it) => {
        // v18 up-next rows are PlaylistPanelVideo: id lives in video_id
        const id = it.id || it.video_id || it.endpoint?.payload?.videoId;
        if (!id) return null;
        return mapTrack({
          id,
          title: it.title?.text || it.title,
          artists: it.artists || [],
          album: it.album?.name || it.album || null,
          duration: typeof it.duration === 'number' ? it.duration : it.duration?.seconds,
          thumbnails:
            it.thumbnails ||
            (Array.isArray(it.thumbnail)
              ? it.thumbnail
              : it.thumbnail?.contents || it.thumbnail?.thumbnails),
        });
      })
      .filter(Boolean);
    return tracks;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* YT Music native lyrics (unsynced)                                   */
/* ------------------------------------------------------------------ */

export async function getYTMusicLyrics(videoId) {
  try {
    const yt = await getYT();
    const shelf = await yt.music.getLyrics(videoId);
    const text = shelf?.description?.text || shelf?.description?.toString?.() || '';
    return text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

/** Captions/transcript (best effort — blocked on some IPs). */
export async function getTranscript(videoId) {
  try {
    const yt = await getYT();
    const info = await yt.getInfo(videoId, 'WEB');
    const tr = await info.getTranscript();
    const segs = tr?.transcript?.content?.body?.initial_segments || [];
    return segs
      .map((s) => ({
        startMs: s.start_ms || 0,
        endMs: s.end_ms || 0,
        text: (s.snippet?.runs || []).map((r) => r.text).join(''),
      }))
      .filter((s) => s.text.trim());
  } catch {
    return [];
  }
}

/** Official watch-next metadata for a video: clean title, full artist list,
 *  album + year, exact duration. This is the same data ytmusicapi builds its
 *  song objects from — perfect for de-dirtying lyrics matching. */
export async function getTrackWatchMeta(videoId) {
  try {
    const yt = await getYT();
    const up = await withTimeout(yt.music.getUpNext(videoId), 6000, null);
    const t = up?.contents?.[0];
    if (!t) return null;
    const title = typeof t.title === 'string' ? t.title : t.title?.text;
    if (!title) return null;
    return {
      title,
      artists: (t.artists || []).map((a) => a?.name).filter(Boolean),
      artistIds: (t.artists || []).map((a) => a?.id || a?.channel_id).filter(Boolean),
      album: t.album?.name || null,
      albumId: t.album?.id || null,
      year: t.album?.year || null,
      duration: typeof t.duration === 'number' ? t.duration : t.duration?.seconds || 0,
    };
  } catch (err) {
    console.error('[yt] watch meta failed:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Single-track card (share links)                                     */
/* ------------------------------------------------------------------ */

export async function getTrackCard(videoId) {
  try {
    const meta = await getTrackWatchMeta(videoId);
    if (meta?.title) {
      return {
        id: videoId,
        source: 'yt',
        title: meta.title,
        artists: meta.artists || [],
        artistIds: meta.artistIds || [],
        album: meta.album || null,
        albumId: meta.albumId || null,
        duration: meta.duration || 0,
        thumb: pickThumbFromVideoId(videoId),
        explicit: false,
      };
    }
  } catch {
    /* fall through */
  }
  // oEmbed first: public, keyless, immune to player bot-checks
  try {
    const r = await safeFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`,
      { timeout: 6000 },
    );
    if (r?.ok) {
      const j = await r.json();
      if (j.title) {
        return {
          id: videoId,
          source: 'yt',
          title: String(j.title),
          artists: j.author_name ? [String(j.author_name)] : [],
          album: null,
          duration: 0, // filled client-side from audio metadata on play
          thumb: j.thumbnail_url || pickThumbFromVideoId(videoId),
          explicit: false,
        };
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const yt = await getYT();
    const info = await yt.music.getInfo(videoId);
    const b = info.basic_info || {};
    const author = b.author?.name || b.author || '';
    return {
      id: videoId,
      source: 'yt',
      title: b.title || 'Unknown',
      artists: author ? [author] : [],
      album: null,
      duration: b.duration || 0,
      thumb: pickThumb(b.thumbnails) || pickThumbFromVideoId(videoId),
      explicit: false,
    };
  } catch (err) {
    console.error('[yt] track card failed:', err.message);
    return null;
  }
}

function pickThumbFromVideoId(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Drop the Innertube session (fresh player cipher) — used when a client
 *  reports stale/403 stream URLs so retries don't reuse a dead cipher. */
export function resetSession() {
  ytPromise = null;
}

/* ------------------------------------------------------------------ */
/* Stream resolution (multi-client cascade)                            */
/* ------------------------------------------------------------------ */

// Client order matters. Try the public clients first; a general WEB PO token
// is not a VISIONOS sign-in and must never opt us into its login-only player.
function buildStreamClients() {
  // Public clients provide independent playback routes. Keep MWEB last: its
  // signed URLs are the one that repeatedly returned 403 for this instance.
  const base = ['WEB', 'YTMUSIC', 'ANDROID', 'IOS', 'YTMUSIC_ANDROID', 'MWEB'];
  // VISIONOS is usable only with both a signed-in session and a token minted
  // for that client. A generic or web-family token causes LOGIN_REQUIRED.
  if (process.env.YT_COOKIE && process.env.YT_PO_TOKEN_VISIONOS) base.push('VISIONOS');
  return base;
}

const poTokenCache = new Map();
const poTokenPending = new Map();

function clientPoToken(client) {
  const key = client.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
  return process.env[`YT_PO_TOKEN_${key}`] || undefined;
}

/** Optional local BgUtils-compatible provider; generated tokens are video-bound. */
async function getVideoPoToken(client, videoId) {
  const fixed = clientPoToken(client);
  if (fixed) return fixed;
  const webTokenFamily = ['YTMUSIC', 'WEB', 'MWEB'].includes(client);
  if (!webTokenFamily) return undefined;
  const endpoint = process.env.YT_PO_TOKEN_PROVIDER_URL;
  if (!endpoint) return process.env.YT_PO_TOKEN || undefined;

  // These three clients share the Web PO-token family; cache one generated
  // content-bound token for the entire resolver pass instead of minting three.
  const key = `web:${videoId}`;
  const hit = poTokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const pending = poTokenPending.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const url = new URL(endpoint);
      if (!url.pathname.endsWith('/get_pot')) url.pathname = `${url.pathname.replace(/\/$/, '')}/get_pot`;
      const response = await safeFetch(url.href, {
        timeout: 5000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content_binding: videoId }),
      });
      if (!response?.ok) return undefined;
      const payload = await response.json().catch(() => null);
      const token = payload?.poToken || payload?.po_token;
      if (typeof token !== 'string' || !token) return undefined;
      const expiry = Date.parse(payload.expiresAt || payload.expires_at || '');
      const ttl = Number.isFinite(expiry) ? Math.max(60_000, Math.min(expiry - Date.now(), 6 * 3600_000)) : 60 * 60_000;
      poTokenCache.set(key, { token, expiresAt: Date.now() + ttl });
      return token;
    } catch (err) {
      console.warn(`[stream] PO token provider failed: ${err?.message || err}`);
      return undefined;
    }
  })().finally(() => poTokenPending.delete(key));
  poTokenPending.set(key, request);
  return (await request) || process.env.YT_PO_TOKEN || undefined;
}

/**
 * Resolve the best audio-only stream URL for a video id.
 * Tries each client until one returns playable streaming data.
 * @returns {{url:string, mime?:string, bitrate?:number, client:string}|null}
 */
// The route order is Saavn, then YouTube's normal clients, then yt-dlp as the last resort.
// yt-dlp is a whole process per call, so only two run at once (a queued
// pre-fetch must never starve the search or the song being played), and a
// missing binary is forgotten after five minutes, not for the life of the server.
const YTDLP_MAX = 2;
let ytDlpRunning = 0;
const ytDlpWaiting = [];
let ytDlpMissingUntil = 0;
const ytDlpInflight = new Map();

async function withYtDlpSlot(task) {
  if (ytDlpRunning >= YTDLP_MAX) await new Promise((resolve) => ytDlpWaiting.push(resolve));
  ytDlpRunning += 1;
  try {
    return await task();
  } finally {
    ytDlpRunning -= 1;
    ytDlpWaiting.shift()?.();
  }
}

function resolveWithYtDlp(videoId) {
  if (Date.now() < ytDlpMissingUntil) return Promise.resolve(null);
  const running = ytDlpInflight.get(videoId);
  if (running) return running;
  const task = withYtDlpSlot(() => resolveWithYtDlpOnce(videoId)).finally(() => ytDlpInflight.delete(videoId));
  ytDlpInflight.set(videoId, task);
  return task;
}

async function resolveWithYtDlpOnce(videoId) {
  try {
    const { stdout } = await execFile(ytDlpExecutable(), [
      '--no-warnings', '--no-playlist',
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio',
      '--dump-single-json', '--', `https://music.youtube.com/watch?v=${videoId}`,
    ], { timeout: 25_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const info = JSON.parse(stdout);
    const audioFormats = (info.formats ?? info.requested_formats ?? [info])
      .filter((format) => format.url && format.acodec !== 'none' && (format.vcodec === 'none' || !format.vcodec))
      .sort((a, b) => Number(b.ext === 'm4a') - Number(a.ext === 'm4a') || Number(b.abr ?? 0) - Number(a.abr ?? 0));
    const format = audioFormats[0];
    if (!format?.url) return null;
    const mime = format.mime_type ?? (format.ext === 'm4a' ? 'audio/mp4' : format.ext === 'opus' || format.ext === 'webm' ? 'audio/webm' : 'audio/mpeg');
    const expires = Number(new URL(format.url).searchParams.get('expire'));
    return {
      url: format.url,
      mime,
      bitrate: Math.round(Number(format.abr ?? 0) * 1000),
      // Only an exact size may be used to validate proxy byte ranges.
      contentLength: format.filesize ?? null,
      expiresAt: Number.isFinite(expires) && expires > 0 ? expires * 1000 : Date.now() + 5 * 60_000,
      client: 'yt-dlp',
    };
  } catch (err) {
    if (err?.code === 'ENOENT') ytDlpMissingUntil = Date.now() + 5 * 60_000;
    console.warn(`[stream] ${videoId} yt-dlp fallback failed: ${err?.message || err}`);
    return null;
  }
}

const FAST_CLIENTS = [
  {
    name: 'VISIONOS',
    version: '1.02',
    id: '82',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    name: 'ANDROID_VR',
    version: '1.60.19',
    id: '28',
    ua: 'Mozilla/5.0 (Linux; Android 12; Quest 3 Build/SQ3A.220605.009.A1) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.35.53.585721111 SamsungBrowser/4.0 Chrome/122.0.6261.119 Mobile VR Safari/537.36',
  },
];

const fastClientCooldown = new Map();

/**
 * Tokenless Fast Audio Stream Resolver.
 * Races raw POST https://www.youtube.com/youtubei/v1/player?prettyPrint=false for VISIONOS and ANDROID_VR
 * with a 2,500ms timeout.
 */
export async function resolveFastAudio(videoId, preferOpus = false) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const now = Date.now();
  const availableClients = FAST_CLIENTS.filter(
    (c) => (fastClientCooldown.get(`${c.name}:${videoId}`) || 0) < now
  );
  if (!availableClients.length) return null;

  const resolveClient = async (client) => {
    const key = `${client.name}:${videoId}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);

      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Youtube-Client-Name': client.id,
          'X-Youtube-Client-Version': client.version,
          'User-Agent': client.ua,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.name,
              clientVersion: client.version,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        fastClientCooldown.set(key, Date.now() + 10 * 60_000);
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.playabilityStatus?.status !== 'OK') {
        fastClientCooldown.set(key, Date.now() + 10 * 60_000);
        throw new Error(`Playability: ${data.playabilityStatus?.status}`);
      }

      const adaptive = data.streamingData?.adaptiveFormats || [];
      const audioFormats = adaptive.filter(
        (f) =>
          f.url &&
          f.mimeType?.includes('audio') &&
          !f.isAutoDubbed &&
          f.audioTrack?.audioIsDefault !== false &&
          !f.isDrc &&
          !/drc/i.test(f.qualityLabel || '')
      );

      if (!audioFormats.length) {
        fastClientCooldown.set(key, Date.now() + 10 * 60_000);
        throw new Error('No direct audio format');
      }

      const sorted = [...audioFormats].sort((a, b) => {
        if (preferOpus) {
          const isOpusA = a.itag === 251 || /opus|webm/i.test(a.mimeType || '');
          const isOpusB = b.itag === 251 || /opus|webm/i.test(b.mimeType || '');
          if (isOpusA !== isOpusB) return isOpusA ? -1 : 1;
        } else {
          // Prefer AAC itag 141 or 140
          const isAacA = a.itag === 141 || a.itag === 140 || /mp4a|mp4/i.test(a.mimeType || '');
          const isAacB = b.itag === 141 || b.itag === 140 || /mp4a|mp4/i.test(b.mimeType || '');
          if (isAacA !== isAacB) return isAacA ? -1 : 1;
        }
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

      const chosen = sorted[0];
      if (!chosen?.url) {
        fastClientCooldown.set(key, Date.now() + 10 * 60_000);
        throw new Error('No valid stream url');
      }

      return {
        url: chosen.url,
        mime: chosen.mimeType?.split(';')[0] || (preferOpus ? 'audio/webm' : 'audio/mp4'),
        bitrate: chosen.bitrate || 130000,
        contentLength: chosen.contentLength ? Number(chosen.contentLength) : null,
        client: client.name,
      };
    } catch (err) {
      fastClientCooldown.set(key, Date.now() + 10 * 60_000);
      throw err;
    }
  };

  return await Promise.any(availableClients.map(resolveClient)).catch(() => null);
}

export async function resolveStream(videoId, { skipClients = [], preferOpus = false, wrapper = 'auto' } = {}) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  if (wrapper === 'yt-dlp') return resolveWithYtDlp(videoId);

  // 1. Tokenless fast audio resolver (VISIONOS + ANDROID_VR raced via Promise.any)
  const fast = await resolveFastAudio(videoId, preferOpus).catch(() => null);
  if (fast?.url) return fast;

  // 2. Direct PO-Token Resolution: Instant (~400ms), 0 403s, 0 bot-check failures
  const distubeFallback = await resolveDistubeAudioStream(videoId, preferOpus).catch(() => null);
  if (distubeFallback?.url) return distubeFallback;

  // 3. Fallback to local yt-dlp binary if available
  return resolveWithYtDlp(videoId).catch(() => null);
}

const videoMetaCache = new Map();
const mvResolveCache = new Map();

function normSequel(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\biv\b/g, '4')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\bi\b/g, '1')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectPart(str) {
  if (!str) return null;
  const s = normSequel(str);
  // 1. Explicit Part / Pt / Vol / Chapter
  const m = s.match(/(?:part|pt|vol|volume|chapter)\s*([0-9]+)/);
  if (m) return parseInt(m[1], 10);
  // 2. Sequel number after franchise word: e.g. "awarapan 2", "hate story 4", "dhoom 3"
  const m2 = s.match(/\b[a-z]{3,}\s+([2-9])\b/);
  if (m2) return parseInt(m2[1], 10);
  // 3. Keywords indicating continuation or sequel 2
  if (/\b(?:continues|continuation|new version|returns|reloaded|reboot)\b/.test(s)) return 2;
  return null;
}

// 1. Hard-rejected keywords (no live, no lyrics, no fan-made/edits, no audio-only, no interviews/talk-shows)
const BANNED_RE =
  /\b(live|concert|unplugged|acoustic|session|performance|tour|festival|lyrical|lyric\s*video|lyrics|with\s*lyrics|audio|official\s*audio|full\s*audio|fan\s*made|fanmade|edit|status|whatsapp|shorts|#shorts|teaser|trailer|promo|making|bts|behind\s*the\s*scenes|reaction|cover|karaoke|instrumental|8d|slowed|reverb|sped\s*up|lofi|lo-fi|mashup|jukebox|remix|dj\s*mix|interview|talk\s*show|podcast|q&a|vlog|speech|documentary|review|tutorial|dance\s*practice|choreography|audition)\b/i;

// 2. Trusted official Indian & global label channels (blocks fan-made re-uploads)
const INDIAN_LABELS_RE =
  /\b(t-series|sony\s*music|zee\s*music|yrf|yash\s*raj|saregama|tips\s*official|tips\s*films|venus|shemaroo|speed\s*records|white\s*hill|eros\s*now|ultra\s*bollywood|ishtar\s*music|junglee\s*music|aditya\s*music|lahari\s*music|think\s*music|muzik247|desi\s*music\s*factory|vyrl|panorama\s*music|times\s*music|gaane\s*sune\s*ansune|bollywood\s*classics|goldmines|dharma|red\s*chillies)\b/i;

const GLOBAL_LABELS_RE =
  /\b(vevo|atlantic|interscope|republic|columbia|warner|universal|def\s*jam|rca\s*records|capitol|island\s*records|epic\s*records|fueled\s*by\s*ramen|monstercat|spinnin|ultra\s*records|hybe|jyp|smtown|yg\s*entertainment|xl\s*recordings|beggars|domino|sub\s*pop|matador|4ad|virgin\s*records|emi|geffen|polydor|parlophone)\b/i;

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5' };

const tokens = (s = '') =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

function sequelNumbers(s = '') {
  const out = new Set();
  for (const t of tokens(s)) {
    if (/^\d+$/.test(t) && Number(t) >= 2 && Number(t) <= 20) out.add(t);
    else if (ROMAN[t]) out.add(ROMAN[t]);
  }
  return out;
}

function sameSequel(src, cand) {
  const a = sequelNumbers(src);
  const b = sequelNumbers(cand);
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

function isOfficialChannel(channel, cleanArtist) {
  const ch = channel.toLowerCase().trim();
  if (!ch || /-\s*topic$/.test(ch)) return null; // never pick auto-generated audio Topic channels

  const chAlpha = ch.replace(/[^a-z0-9]/g, '');

  // Split multi-artist strings (e.g. "Adele", "Arijit Singh, Pritam", "The Weeknd & Daft Punk")
  const individualArtists = (cleanArtist || '')
    .split(/[,;&/]|(?:\b(?:feat|ft|with|and)\b)/i)
    .map((a) => a.trim())
    .filter(Boolean);

  for (const artist of individualArtists) {
    const artistAlpha = artist.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!artistAlpha) continue;

    // Check Vevo (e.g. AdeleVEVO, PostMaloneVEVO)
    if (chAlpha.endsWith('vevo') && (chAlpha.includes(artistAlpha) || artistAlpha.includes(chAlpha.replace(/vevo$/, '')))) {
      return 'vevo';
    }

    // Direct channel match (e.g. "Adele", "Red Hot Chili Peppers")
    if (chAlpha === artistAlpha || chAlpha.includes(artistAlpha) || artistAlpha.includes(chAlpha)) {
      return 'artist';
    }

    const words = tokens(artist).filter((w) => w.length > 1);
    if (words.length > 0 && words.every((w) => ch.includes(w))) {
      return 'artist';
    }
  }

  if (INDIAN_LABELS_RE.test(ch)) return 'indian_label';
  if (GLOBAL_LABELS_RE.test(ch)) return 'global_label';
  return null; // anything else (fan channels, random uploaders) -> rejected
}

export function pickBestMusicVideo(candidates, { cleanTitle, cleanArtist, album = '', targetDuration = 0 }) {
  const titleWords = tokens(cleanTitle).filter((w) => w.length > 1);
  const artistWords = tokens(cleanArtist).filter((w) => w.length > 1);
  const albumWords = tokens(album).filter((w) => w.length > 2);
  const srcText = `${cleanTitle} ${album}`;

  if (!titleWords.length) return null;

  const valid = [];

  for (const v of candidates) {
    const rawTitle = (v?.title?.text || v?.title || '').trim();
    const channel = (v?.author?.name || v?.author?.text || v?.channel || v?.author || '').trim();
    const duration = Number(v?.duration?.seconds || v?.duration || 0);
    if (!rawTitle || !channel) continue;

    // A. Reject banned types (live, lyrics, fan-made, remix, interview, etc.) unless the song itself has that word
    const bannedMatch = rawTitle.match(BANNED_RE);
    if (bannedMatch && !new RegExp(`\\b${bannedMatch[0]}\\b`, 'i').test(srcText)) continue;

    // Also reject if channel has banned keywords (like "Live Concerts", "Interview Channel")
    if (BANNED_RE.test(channel)) continue;

    // B. Duration sanity (blocks shorts, teasers, movie clips, jukeboxes)
    if (duration > 0) {
      if (duration < 45 || duration > 540) continue;
      if (targetDuration > 0) {
        const minDur = Math.max(45, targetDuration - 25);
        const maxDur = Math.min(540, Math.round(targetDuration * 1.5 + 60));
        if (duration < minDur || duration > maxDur) continue;
      }
    }

    // C. Sequel lock (e.g. Awarapan 1 vs 2)
    if (!sameSequel(srcText, rawTitle)) continue;

    // D. Exact song title check
    const candWords = new Set(tokens(rawTitle));
    const hits = titleWords.filter((w) => candWords.has(w)).length;
    const minRatio = titleWords.length <= 3 ? 1.0 : 0.85;
    if (hits / titleWords.length < minRatio) continue;

    // E. Official channel ONLY (Vevo / artist's own channel / Indian & global official labels)
    const authority = isOfficialChannel(channel, cleanArtist);
    if (!authority) continue;

    // For label channels (e.g. T-Series / Sony / Zee), confirm artist OR movie/album appears in the video title
    if (authority === 'indian_label' || authority === 'global_label') {
      const lower = rawTitle.toLowerCase();
      const hasArtist = artistWords.some((w) => lower.includes(w));
      const hasAlbum = albumWords.length > 0 && albumWords.some((w) => lower.includes(w));
      if (!hasArtist && !hasAlbum) continue;
    }

    // --- Step 2: Simple ranking among verified official MVs ---
    let rank = 0;

    // Prefer 8K / 4K remasters (great for T-Series / Sony / Zee classic Indian songs)
    if (/\b(8k|4320p)\b/i.test(rawTitle)) rank += 45;
    else if (/\b(4k|2160p|uhd|remastered)\b/i.test(rawTitle)) rank += 35;

    // Prefer explicit music video labels
    if (/\bofficial\s*(music\s*)?video\b|\bofficial\s*mv\b/i.test(rawTitle)) rank += 35;
    else if (/\bfull\s*video\b|\bvideo\s*song\b/i.test(rawTitle)) rank += 20;

    // Channel authority tie-breaker
    if (authority === 'vevo') rank += 30;
    else if (authority === 'artist') rank += 25;
    else if (authority === 'indian_label') rank += 20;
    else if (authority === 'global_label') rank += 20;

    // Closer duration to the original audio track
    if (duration > 0 && targetDuration > 0 && Math.abs(duration - targetDuration) <= 15) {
      rank += 15;
    }

    valid.push({ video: v, rank });
  }

  if (!valid.length) return null; // No official MV found -> stay as-is
  valid.sort((a, b) => b.rank - a.rank);
  return valid[0].video;
}

export async function resolveMusicVideo(title, artist, songVideoId, opts = {}) {
  const album = String(opts.album || '').trim();
  const targetDuration = parseFloat(opts.duration || '0') > 0 ? parseFloat(opts.duration || '0') : 0;

  const cleanTitle = (title || '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/official\s+(?:music\s+)?video/gi, '')
    .replace(/full\s+(?:audio|video)\s+song/gi, '')
    .replace(/lyrics?/gi, '')
    .trim();

  const cleanArtist = (artist || '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/feat\..*$/i, '')
    .replace(/ft\..*$/i, '')
    .trim();

  const queryKey = [cleanTitle, cleanArtist, album, targetDuration ? Math.round(targetDuration) : ''].join('|').toLowerCase();
  if (mvResolveCache.has(queryKey)) {
    return mvResolveCache.get(queryKey);
  }

  try {
    const yt = await getYT();

    // 2 parallel searches: one official music video query and one 4K remaster query
    const queries = [
      `${cleanArtist} ${cleanTitle} official music video`.trim(),
      album && !cleanTitle.toLowerCase().includes(album.toLowerCase())
        ? `${cleanTitle} ${album} 4k full video song`.trim()
        : `${cleanArtist} ${cleanTitle} 4k official video`.trim(),
    ];

    const settled = await Promise.allSettled(
      queries.map((q) => yt.search(q, { type: 'video' }))
    );

    const deduped = new Map();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const v of r.value?.videos || []) {
        const id = v?.id;
        if (id && !deduped.has(id)) deduped.set(id, v);
      }
    }

    const best = pickBestMusicVideo([...deduped.values()], {
      cleanTitle,
      cleanArtist,
      album,
      targetDuration,
    });

    if (best && best.id) {
      const result = {
        videoId: best.id,
        title: best.title?.text || best.title || title,
        thumbnail: `https://i.ytimg.com/vi/${best.id}/hqdefault.jpg`,
      };
      mvResolveCache.set(queryKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[yt] resolveMusicVideo error:', err?.message || err);
  }

  // If no official MV passes strict verification, cache null so client cleanly stays on artwork/visualizer
  mvResolveCache.set(queryKey, null);
  return null;
}

/**
 * High-definition Video Stream Resolver (1080p/720p H.264 MP4)
 * Returns direct or deciphered Google Video stream metadata for hardware-accelerated playback.
 */
export async function resolveVideoStream(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  const now = Date.now();
  const cached = videoMetaCache.get(videoId);
  if (cached && now < cached.expiresAt) {
    return cached;
  }

  const yt = await getYT();

  // 1. Instant Fast Path: Direct IOS /player call (Returns direct unencrypted 1080p/720p H.264 MP4 in ~300ms)
  try {
    const raw = await withTimeout(yt.actions.execute('/player', { videoId, client: 'IOS' }), 3500, null);
    const adaptive = raw?.data?.streamingData?.adaptiveFormats || [];
    const videos = adaptive.filter((f) => f.mimeType?.includes('video') && f.url);
    if (videos.length) {
      const chosen =
        videos.find((f) => /^1080p/i.test(f.qualityLabel || '') && /avc1/i.test(f.mimeType || '')) ||
        videos.find((f) => /^720p/i.test(f.qualityLabel || '') && /avc1/i.test(f.mimeType || '')) ||
        videos.find((f) => /avc1/i.test(f.mimeType || '')) ||
        videos.find((f) => /^1080p/i.test(f.qualityLabel || '') && /mp4/i.test(f.mimeType || '')) ||
        videos.find((f) => /^720p/i.test(f.qualityLabel || '') && /mp4/i.test(f.mimeType || '')) ||
        videos.find((f) => /mp4/i.test(f.mimeType || '')) ||
        videos[0];

      if (chosen?.url) {
        const meta = {
          videoId,
          url: chosen.url,
          mime: chosen.mimeType?.split(';')[0] || 'video/mp4',
          contentLength: Number(chosen.contentLength) || null,
          width: chosen.width || 1280,
          height: chosen.height || 720,
          quality: chosen.qualityLabel || `${chosen.height}p`,
          expiresAt: now + 3 * 3600_000,
        };
        videoMetaCache.set(videoId, meta);
        return meta;
      }
    }
  } catch {}

  const clients = ['IOS', 'ANDROID', 'WEB'];

  for (const client of clients) {
    try {
      const options = { client };
      const info = await withTimeout(yt.getInfo(videoId, options), 6500, null);
      if (!info) continue;

      const adaptive = info.streaming_data?.adaptive_formats || [];
      const vFormats = adaptive.filter(
        (f) => f.has_video && (/mp4/i.test(f.mime_type || '') || /webm/i.test(f.mime_type || ''))
      );
      if (!vFormats.length) continue;

      // Prioritize optimal fluid HD (1080p -> 720p) in H.264 MP4 for instant start and GPU hardware acceleration.
      // Avoid massive 4K/8K AV1 streams that cause buffering stalls and frame drops in browsers.
      const rankHeight = (h) => (h === 1080 ? 4 : h === 720 ? 3 : h > 1080 ? 2 : h >= 480 ? 1 : 0);
      const sorted = [...vFormats].sort((a, b) => {
        const isAvc1A = /avc1/i.test(a.mime_type || '');
        const isAvc1B = /avc1/i.test(b.mime_type || '');
        if (isAvc1A !== isAvc1B) return isAvc1A ? -1 : 1;

        const hA = a.height || 0;
        const hB = b.height || 0;
        const rA = rankHeight(hA);
        const rB = rankHeight(hB);
        if (rA !== rB) return rB - rA;

        const isMp4A = /mp4/i.test(a.mime_type || '');
        const isMp4B = /mp4/i.test(b.mime_type || '');
        if (isMp4A !== isMp4B) return isMp4A ? -1 : 1;
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

      const chosen = sorted[0];

      if (!chosen) continue;

      let url = chosen.url || null;
      if (!url && typeof chosen.decipher === 'function') {
        try {
          url = await chosen.decipher(yt.session.player);
        } catch {
          url = null;
        }
      }

      if (!url || typeof url !== 'string') continue;

      const meta = {
        videoId,
        url,
        mime: chosen.mime_type?.split(';')[0] || 'video/mp4',
        contentLength: Number(chosen.content_length) || null,
        width: chosen.width || 1280,
        height: chosen.height || 720,
        quality: chosen.quality_label || `${chosen.height}p`,
        expiresAt: now + 3 * 3600_000,
      };

      videoMetaCache.set(videoId, meta);
      return meta;
    } catch {
      // try next client
    }
  }

  // Fallback: yt-dlp if installed on host
  try {
    const bin = ytDlpExecutable();
    const { stdout } = await execFile(bin, [
      '-g',
      '-f', 'bestvideo[ext=mp4][height<=1080]/bestvideo[height<=1080]/bestvideo',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 12000 });
    const url = stdout.trim().split('\n')[0];
    if (url && /^https?:\/\//i.test(url)) {
      const meta = {
        videoId,
        url,
        mime: 'video/mp4',
        contentLength: null,
        width: 1280,
        height: 720,
        quality: '720p',
        expiresAt: now + 2 * 3600_000,
      };
      videoMetaCache.set(videoId, meta);
      return meta;
    }
  } catch {}

  return null;
}

