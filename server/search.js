/* search.js — the Search tab's engine: YouTube Music search,
 * continuation, suggestions and typeahead.
 *
 * What it does, and deliberately does NOT do:
 *   • Asks YouTube Music for exactly what was typed, with the filter chip's own
 *     protobuf `params` (All / Songs / Videos / Albums / Artists / Playlists).
 *   • Keeps YouTube's order. Nothing here scores, boosts, "ranks" or drops rows
 *     by popularity: the first row is the promoted top result YouTube chose.
 *   • Pages with the response's own continuation token, so the list can grow
 *     as it is scrolled.
 *   • Typeahead is two cheap calls: `music/get_search_suggestions` for the
 *     completions, and an unfiltered search for the live song/artist rows.
 *
 * Row shapes returned to the client:
 *   { kind: 'top',    track }               the promoted song on the All page
 *   { kind: 'track',  track }               a song / video
 *   { kind: 'browse', item: Card }          an artist / album / playlist
 *   (a promoted artist/album/playlist card is { kind:'browse', item, top:true })
 */

import { collectRenderers, getYT, kindForBrowseId, parseDuration, pickThumb } from './yt.js';
import { safeFetch, UA, withTimeout } from './cache.js';

/** SearchFilter: the label and the `params` YouTube filters with. */
export const SEARCH_FILTERS = {
  all: null,
  songs: 'EgWKAQIIAWoKEAkQChAFEAMQBA==',
  videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA==',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA==',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA==',
  playlists: 'EgWKAQIoAWoKEAkQChAFEAMQBA==',
};

export const normalizeFilter = (value) => {
  const key = String(value || 'all').toLowerCase();
  return key in SEARCH_FILTERS ? key : 'all';
};

/* ------------------------------------------------------------------ */
/* Small readers over the raw renderer JSON                            */
/* ------------------------------------------------------------------ */

const runsText = (node) =>
  node?.runs ? node.runs.map((run) => run.text || '').join('') : node?.simpleText || '';

const DURATION = /^\d{1,2}(?::\d{2}){1,2}$/;
const TALLY = /^[\d.,]+\s*[kmb]?\s*(?:views?|plays?|listeners?|subscribers?|monthly audience|streams?)\b/i;
const VIDEO_WORD = /\bvideos?\b/i;
const TYPE_WORDS = new Set(['song', 'video', 'episode', 'single', 'album', 'ep', 'playlist', 'artist', 'podcast', 'profile']);

export function isNotArtist(part) {
  if (!part || typeof part !== 'string') return true;
  const s = part.trim();
  if (!s) return true;
  if (TYPE_WORDS.has(s.toLowerCase())) return true;
  if (/\b\d{1,2}(?::\d{2}){1,2}\b/.test(s)) return true;
  if (/\b(?:plays?|views?|listeners?|subscribers?|streams?|monthly|audience|crore|cr|lakh)\b/i.test(s)) return true;
  if (/^[\d.,\s]+[kmb]?$/i.test(s)) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s*\d{4}$/i.test(s)) return true;
  if (/^\d{4}$/.test(s)) return true;
  if (/^[•·|,&/–—\s\-:]+$/.test(s)) return true;
  return false;
}

const pageTypeOf = (endpoint) =>
  String(
    endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '',
  ).toUpperCase();

/** A catalogue song's art is square; a music-video upload's is widescreen. */
function isNotSquare(thumbs) {
  const best = [...(thumbs || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (!best?.width || !best?.height) return false;
  return Math.abs(best.width / best.height - 1) > 0.06;
}

function hasExplicitBadge(renderer) {
  const badges = [...(renderer?.badges || []), ...(renderer?.subtitleBadges || [])];
  return badges.some(
    (badge) => badge?.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE',
  );
}

/** The artists and album a run list links out to. */
function creditsOf(runs = []) {
  const artists = [];
  const artistIds = [];
  let album = null;
  let albumId = null;
  for (const run of runs) {
    const endpoint = run?.navigationEndpoint?.browseEndpoint;
    const id = endpoint?.browseId;
    if (!id || !run.text || isNotArtist(run.text)) continue;
    const type = pageTypeOf(endpoint);
    if (type.includes('ARTIST') || (!type && id.startsWith('UC'))) {
      artists.push(run.text.trim());
      artistIds.push(id);
    } else if (type.includes('ALBUM') || id.startsWith('MPRE') || id.startsWith('FEmusic_library_album')) {
      if (!albumId) {
        album = run.text.trim();
        albumId = id;
      }
    }
  }
  return { artists, artistIds, album, albumId };
}

function splitByline(runs = []) {
  const text = runs.map((run) => run.text || '').join('');
  const parts = text
    .split(/\s*[•·|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const rowType = parts.map((part) => part.toLowerCase()).find((part) => TYPE_WORDS.has(part)) || null;
  const plainArtist = parts.find((part) => !isNotArtist(part)) || null;
  const duration = [...parts].reverse().find((part) => DURATION.test(part)) || null;
  return { parts, rowType, plainArtist, duration };
}

function trackFrom({ id, title, byline, thumbs, fixedDuration, explicit, fallback }) {
  const { rowType, plainArtist, duration } = splitByline(byline);
  if (rowType === 'episode' || rowType === 'podcast') return null;
  const linked = creditsOf(byline);
  const fb = fallback || {};
  const validLinkedArtists = linked.artists.filter((a) => !isNotArtist(a));
  const validFbArtist = fb.artistName && !isNotArtist(fb.artistName) ? fb.artistName : null;
  const validPlainArtist = plainArtist && !isNotArtist(plainArtist) ? plainArtist : null;

  const artists = validLinkedArtists.length
    ? validLinkedArtists
    : validFbArtist
      ? [validFbArtist]
      : validPlainArtist
        ? [validPlainArtist]
        : [];
  const artistIds = validLinkedArtists.length
    ? linked.artistIds
    : validFbArtist && fb.artistId
      ? [fb.artistId]
      : [];
  const video = rowType === 'video' || isNotSquare(thumbs);
  return {
    id,
    source: 'yt',
    title,
    artists,
    artistIds,
    album: linked.album,
    albumId: linked.albumId,
    duration: parseDuration(duration || fixedDuration || ''),
    thumb: pickThumb(thumbs),
    explicit: !!explicit,
    channel: video && validPlainArtist ? validPlainArtist : null,
    // A music-video upload is somebody's copy: the stream resolver sends it
    // through the catalogue matcher before playing it.
    isUpload: video,
    isVideo: video,
  };
}

/** One `musicResponsiveListItemRenderer` as a song row, or null. */
function parseTrackRow(renderer, fallback) {
  const id =
    renderer?.playlistItemData?.videoId ||
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!id) return null;
  const columns = renderer.flexColumns || [];
  const title = runsText(columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text).trim();
  if (!title) return null;
  const byline = columns
    .slice(1)
    .flatMap((c, i) => {
      const runs = c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      return i > 0 ? [{ text: ' • ' }, ...runs] : runs;
    });
  const fixedDuration = (renderer.fixedColumns || [])
    .map((column) => runsText(column?.musicResponsiveListItemFixedColumnRenderer?.text).trim())
    .find((text) => DURATION.test(text));
  return trackFrom({
    id,
    title,
    byline,
    thumbs: renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
    fixedDuration,
    explicit: hasExplicitBadge(renderer),
    fallback,
  });
}

function browseKind(pageType, id) {
  if (pageType.includes('ALBUM')) return 'album';
  if (pageType.includes('ARTIST')) return 'artist';
  if (pageType.includes('PLAYLIST')) return 'playlist';
  return kindForBrowseId(id) || null;
}

/** An artist / album / playlist row, or null when the row is a song (or a dead end). */
function parseBrowseRow(renderer) {
  const endpoint = renderer?.navigationEndpoint?.browseEndpoint;
  const id = endpoint?.browseId;
  if (!id) return null;
  const pageType = pageTypeOf(endpoint);
  // Uploads YouTube never matched to the catalogue ("Episode" pages) are not music.
  if (pageType.includes('NON_MUSIC_AUDIO_TRACK') || pageType.includes('PODCAST')) return null;
  const columns = renderer.flexColumns || [];
  const title = runsText(columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text).trim();
  if (!title) return null;
  const subtitle = runsText(columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text).trim();
  // "Daily Top Music Videos" style compilations open onto nothing playable.
  if (VIDEO_WORD.test(title) || VIDEO_WORD.test(subtitle)) return null;
  const kind = browseKind(pageType, id);
  if (!kind) return null;
  return {
    id,
    kind,
    title,
    subtitle: subtitle || null,
    thumb: pickThumb(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
  };
}

/** The promoted card at the top of the All page, when it is a song. */
function parseCardSong(card) {
  const id = card?.onTap?.watchEndpoint?.videoId;
  if (!id) return null;
  const title = runsText(card.title).trim();
  if (!title) return null;
  return trackFrom({
    id,
    title,
    byline: card.subtitle?.runs || [],
    thumbs: card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
    explicit: hasExplicitBadge({ subtitleBadges: card.subtitleBadges }),
  });
}

/** The promoted card when it is an artist, album or playlist. */
function parseCardBrowse(card) {
  const endpoint = card?.onTap?.browseEndpoint;
  const id = endpoint?.browseId;
  if (!id) return null;
  const pageType = pageTypeOf(endpoint);
  if (pageType.includes('NON_MUSIC_AUDIO_TRACK')) return null;
  const title = runsText(card.title).trim();
  if (!title) return null;
  const subtitle = runsText(card.subtitle).trim();
  if (VIDEO_WORD.test(title) || VIDEO_WORD.test(subtitle)) return null;
  const kind = browseKind(pageType, id);
  if (!kind) return null;
  return {
    id,
    kind,
    title,
    subtitle: subtitle || null,
    thumb: pickThumb(card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
  };
}

/**
 * Who the song rows hung under an *artist* card are by. They say only
 * "Song • 3:16": the credit is on the card, stated once. (A song card's own
 * rows are other people's uploads, so they get no borrowed credit.)
 */
function cardCredit(card) {
  const endpoint = card?.onTap?.browseEndpoint;
  if (!endpoint || !pageTypeOf(endpoint).includes('ARTIST')) return null;
  const name = runsText(card.title).trim();
  if (!name) return null;
  return { artistId: endpoint.browseId, artistName: name };
}

/** The next-page token, read at exactly the depths YouTube uses. */
export function continuationToken(root) {
  const endpoint = collectRenderers(root, 'continuationItemRenderer')[0]?.continuationEndpoint;
  const direct = endpoint?.continuationCommand?.token;
  if (direct) return direct;
  for (const command of endpoint?.commandExecutorCommand?.commands || []) {
    if (command?.continuationCommand?.token) return command.continuationCommand.token;
  }
  return collectRenderers(root, 'nextContinuationData')[0]?.continuation || null;
}

/**
 * One page of search rows plus the token for the next one.
 * `includeVideos` is true only on the Videos filter: the mixed pages stay
 * music-only and music-video uploads belong to the Videos chip alone.
 */
export function parseSearchPage(data, { includeVideos = false } = {}) {
  const rows = [];
  const seen = new Set();
  const seenSongs = new Set();

  const normalizeSongKey = (track) => {
    if (!track?.title) return null;
    const cleanTitle = String(track.title)
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
      .trim();
    const primaryArtist = String(track.artists?.[0] || track.artist || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')
      .trim();
    return cleanTitle ? `${cleanTitle}|${primaryArtist}` : null;
  };

  const push = (row, key) => {
    if (!key || seen.has(key)) return;
    const track = row.track;
    if (track) {
      const songKey = normalizeSongKey(track);
      if (songKey && seenSongs.has(songKey)) return;
      if (songKey) seenSongs.add(songKey);
    }
    seen.add(key);
    rows.push(row);
  };

  const cards = includeVideos ? [] : collectRenderers(data, 'musicCardShelfRenderer');
  for (const card of cards) {
    const song = parseCardSong(card);
    if (song) {
      if (!song.isVideo) push({ kind: 'top', track: song }, `v:${song.id}`);
      continue;
    }
    const item = parseCardBrowse(card);
    if (item) push({ kind: 'browse', item, top: true }, `b:${item.id}`);
  }

  // Rows inside an artist's promoted card, matched by identity below.
  const borrowed = new Map();
  for (const card of cards) {
    const credit = cardCredit(card);
    if (!credit) continue;
    for (const row of collectRenderers(card, 'musicResponsiveListItemRenderer')) borrowed.set(row, credit);
  }

  for (const renderer of collectRenderers(data, 'musicResponsiveListItemRenderer')) {
    // Browse rows first: an album row also carries a "play album" videoId in
    // its overlay, so checking for a track first would misread it as a song.
    const item = parseBrowseRow(renderer);
    if (item) {
      push({ kind: 'browse', item }, `b:${item.id}`);
      continue;
    }
    const track = parseTrackRow(renderer, borrowed.get(renderer));
    if (track && track.isVideo === includeVideos) push({ kind: 'track', track }, `v:${track.id}`);
  }
  return { rows, continuation: continuationToken(data) };
}

/** The completions out of a `music/get_search_suggestions` response. */
export function parseSearchSuggestions(data) {
  const out = [];
  for (const renderer of collectRenderers(data, 'searchSuggestionRenderer')) {
    const query =
      renderer?.navigationEndpoint?.searchEndpoint?.query || runsText(renderer?.suggestion);
    if (query && query.trim() && !out.includes(query.trim())) out.push(query.trim());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Network                                                              */
/* ------------------------------------------------------------------ */

async function rawSearch(query, params, ms = 6000) {
  const yt = await getYT().catch(() => null);
  if (!yt) return null;
  const response = await withTimeout(
    yt.actions.execute('/search', { query, ...(params ? { params } : {}), client: 'YTMUSIC' }),
    ms,
    null,
  ).catch(() => null);
  return response?.data || null;
}

/** First page for `query` under `filter`. null means YouTube did not answer. */
export async function searchPage(query, filter = 'all') {
  const name = normalizeFilter(filter);
  const data = await rawSearch(query, SEARCH_FILTERS[name]);
  if (!data) return null;
  return parseSearchPage(data, { includeVideos: name === 'videos' });
}

/** The page after `token`. null means YouTube did not answer. */
export async function searchContinuation(token, filter = 'all') {
  const yt = await getYT().catch(() => null);
  if (!yt) return null;
  const response = await withTimeout(
    yt.actions.execute('/search', { token, client: 'YTMUSIC' }),
    6000,
    null,
  ).catch(() => null);
  if (!response?.data) return null;
  return parseSearchPage(response.data, { includeVideos: normalizeFilter(filter) === 'videos' });
}

/** What YouTube Music's own search box completes `input` to. */
export async function searchSuggestions(input) {
  try {
    const yt = await getYT();
    const response = await withTimeout(
      yt.actions.execute('/music/get_search_suggestions', { input, client: 'YTMUSIC' }),
      3500,
      null,
    ).catch(() => null);
    const items = response?.data ? parseSearchSuggestions(response.data) : [];
    if (items.length) return items;
  } catch {
    /* fall through to the public endpoint */
  }
  return publicSuggestions(input);
}

/** YouTube's public type-ahead endpoint, for the days the InnerTube one is silent. */
async function publicSuggestions(query) {
  try {
    const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&hl=en&q=${encodeURIComponent(query)}`;
    const response = await safeFetch(url, { timeout: 2500, headers: { 'user-agent': UA } });
    if (!response?.ok) return [];
    const text = await response.text();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const rows = JSON.parse(text.slice(start, end + 1))?.[1];
    return (Array.isArray(rows) ? rows : [])
      .map((row) => (Array.isArray(row) ? row[0] : row))
      .filter((text) => typeof text === 'string' && text.trim())
      .map((text) => text.trim());
  } catch {
    return [];
  }
}

/** Live media rows for the typeahead: the mixed search, first page only. */
export async function searchTypeahead(input) {
  const page = await searchPage(input, 'all');
  return page ? page.rows : null;
}
