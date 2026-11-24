/**
 * appleart.js — Apple's own artist banner.
 *
 * What Apple's artist page wears: a hero photograph that fills the top of
 * the page, the artist's title logo typeset over it as a separate transparent
 * image, and for many artists a looping motion clip that stands in for the
 * still.
 *
 * Pure Apple Music artist art resolution: a name in, the art out,
 * or null. The JSON Apple's page hydrates from is not an API Apple publishes,
 * so every surprise here means "no art" — the YouTube header stays underneath.
 *
 * Three public, unauthenticated requests:
 *   1. the iTunes search API turns a name into an Apple Music artist id,
 *   2. the catalogue API answers with the artist's picture in three kilobytes
 *      of JSON — the photograph itself, cropped to fill,
 *   3. the artist's own page carries the typeset name, the motion clip and,
 *      for some artists, a wider picture. It is worth the wait, but not the
 *      banner's.
 *
 * The photograph is asked for with Apple's `bb` crop. Apple's social image
 * for an artist is the same picture cut into a circle on a grey field, and
 * that circle was what this banner used to show: a small round portrait
 * floating in an empty rectangle. The `bb` crop is the photograph itself, and
 * it stretches across the page.
 *
 * A search will happily return somebody else, so an answer is only taken when
 * the name Apple gives back is the name that was asked for.
 */

import { AsyncResolver, TTLCache, safeFetch } from './cache.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const WIDE_WIDTH = 2400;
const BANNER_WIDTH = 2400;
const LOGO_WIDTH = 1000;
const APPLE_CATALOG = 'https://amp-api.music.apple.com/v1/catalog';
const APPLE_STOREFRONT = (process.env.APPLE_STOREFRONT || 'us').toLowerCase();
const motionCache = new AsyncResolver(new TTLCache({ max: 256, ttl: 24 * 3600_000 }), { ttl: 24 * 3600_000, negativeTtl: 2 * 3600_000 });
let catalogToken = null;
let catalogTokenExpiry = 0;
let catalogTokenRequest = null;

/** Apple's image service: {w}, {h}, {c} (crop) and {f} (format). */
function fillTemplate(url, w, h, format) {
  if (!url || typeof url !== 'string' || !url.includes('{w}')) return null;
  return url
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', 'bb')
    .replace('{f}', format);
}

/** Preserve Apple's actual composition ratio when asking its image CDN for HD art. */
function imageAtWidth(image, width, fallbackAspect = 1, format = 'webp') {
  if (!image?.url) return null;
  const sourceWidth = Number(image.width);
  const sourceHeight = Number(image.height);
  const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : fallbackAspect;
  return fillTemplate(image.url, width, Math.round(width / aspect), format);
}

/** Case, accents and punctuation are not what makes two names different. */
function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Apple's colours are six hex digits with no prefix. */
function hexColor(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toLowerCase()}` : null;
}

/** The first object anywhere in the tree that carries an `artistLogo` key. */
function findHeader(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, 'artistLogo')) return node;
  for (const key of Object.keys(node)) {
    const hit = findHeader(node[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * The looping clip inside a `videoArtwork` node.
 *
 * Apple files the clips by the shape they were cut for: the banner-sized one
 * under `motionArtistWide16x9`, the full-screen one under
 * `motionArtistFullscreen16x9`, and the square one under
 * `motionArtistSquare1x1`. The banner wants the wide cut first; the square
 * is a last resort and fills the frame without cropping.
 */
const MOTION_KEYS = [
  'motionArtistWide16x9',
  'motionArtistFullscreen16x9',
  'motionArtistWide1x1',
  'motionArtistSquare1x1',
];

function motionFrom(node) {
  const dict = node?.dictionary || node;
  if (!dict || typeof dict !== 'object') return null;
  const keys = [
    ...MOTION_KEYS.filter((key) => dict[key]),
    ...Object.keys(dict).filter((key) => /^motion/i.test(key) && !MOTION_KEYS.includes(key)),
  ];
  for (const key of keys) {
    const value = dict[key];
    const video = value?.video;
    if (typeof video !== 'string' || !video.startsWith('http')) continue;
    const frame = value?.previewFrame;
    const wide = /wide|16x9|fullscreen/i.test(key);
    const aspect = wide ? 16 / 9 : 1;
    return {
      video,
      preview: imageAtWidth(frame, BANNER_WIDTH, aspect, 'jpg'),
      aspect,
    };
  }
  return null;
}

/** The anonymous bearer token used by Apple's web catalog API. */
/** A JWT's expiry in ms, or 0 when it is not one. */
function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

/** The catalog token from the page's `<meta name="…/config/environment">` block, if present and unexpired. */
function tokenFromMeta(html) {
  for (const tag of String(html).match(/<meta[^>]+config\/environment[^>]*>/gi) || []) {
    const content = tag.match(/content="([^"]+)"/i)?.[1];
    if (!content) continue;
    try {
      const config = JSON.parse(decodeURIComponent(content));
      const token = config?.MEDIA_API?.token;
      const expiry = jwtExpiry(token);
      if (typeof token === 'string' && expiry > Date.now() + 60_000) return { token, expiry };
    } catch {
      // not the block we want
    }
  }
  return null;
}

export async function appleCatalogToken() {
  if (catalogToken && catalogTokenExpiry > Date.now() + 60_000) return catalogToken;
  if (catalogTokenRequest) return catalogTokenRequest;
  catalogTokenRequest = (async () => {
    // Try regional storefronts — token lives in the page meta / bundle JS.
    const pages = [
      'https://music.apple.com/us/browse',
      'https://music.apple.com/in/browse',
      'https://music.apple.com/gb/browse',
    ];
    const headers = {
      'User-Agent': UA || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    for (const pageUrl of pages) {
      const page = await safeFetch(pageUrl, { timeout: 10_000, headers });
      if (!page?.ok) continue;
      const html = await page.text();
      const fromMeta = tokenFromMeta(html);
      if (fromMeta) {
        catalogToken = fromMeta.token;
        catalogTokenExpiry = fromMeta.expiry;
        return catalogToken;
      }
      const assets = [...html.matchAll(/\/assets\/index(?:-legacy)?[~-][A-Za-z0-9_-]+\.js/g)].map((m) => m[0]);
      for (const asset of [...new Set(assets)].slice(0, 5)) {
        const response = await safeFetch(`https://music.apple.com${asset}`, { timeout: 10_000, headers: { ...headers, Accept: '*/*' } });
        if (!response?.ok) continue;
        const source = await response.text();
        const candidates = [...new Set(source.match(/ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [])];
        const decoded = candidates.map((token) => {
          try {
            const [headerPart, payloadPart] = token.split('.');
            const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
            const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
            return { token, header, payload, expiry: Number(payload.exp) * 1000 };
          } catch { return null; }
        }).filter((item) => item?.expiry > Date.now());
        const chosen = decoded.find((item) => /WebPlayKid|AMPWebPlay|MediaAPI/i.test(JSON.stringify(item))) || decoded[0];
        if (!chosen) continue;
        catalogToken = chosen.token;
        catalogTokenExpiry = chosen.expiry;
        return catalogToken;
      }
    }
    return null;
  })().catch((error) => {
    console.warn('[apple] catalog token lookup failed:', error?.message || error);
    return null;
  }).finally(() => { catalogTokenRequest = null; });
  return catalogTokenRequest;
}

export async function appleCatalogGet(url, token) {
  const response = await safeFetch(url, {
    timeout: 9000,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://music.apple.com',
      Referer: 'https://music.apple.com/',
      Accept: 'application/json',
      'User-Agent': UA,
    },
  });
  if (response?.status === 401) {
    catalogToken = null;
    catalogTokenExpiry = 0;
  }
  return response?.ok ? response.json().catch(() => null) : null;
}

const motionTitleKey = (value) => normalizeName(String(value || '').replace(/\((?:from|feat\.?|ft\.?|with|official|audio|video|lyrics?)[^)]*\)/gi, ' '));
const motionArtists = (value) => String(value || '').split(/,|&|\bfeat(?:uring)?\.?\b/i).map(normalizeName).filter(Boolean);
function motionMatchesArtist(wanted, found) {
  const wantedParts = motionArtists(wanted);
  const foundParts = motionArtists(found);
  return wantedParts.some((part) => foundParts.some((fp) => fp.includes(part) || part.includes(fp)));
}

function editorialMotion(video) {
  if (!video || typeof video !== 'object') return null;
  const candidates = [
    'motionDetailSquare', 'motionSquareVideo1x1', 'motionDetailRaw',
    'motionDetailTall', 'motionTallVideo3x4',
  ];
  for (const key of candidates) {
    const asset = video[key];
    if (!asset || typeof asset !== 'object') continue;
    const url = asset.video || asset.videoUrl || asset.hlsUrl || asset.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return { url, aspect: /tall|3x4/i.test(key) ? 3 / 4 : 1 };
    }
  }
  return null;
}

async function fetchAlbumMotion(albumId, expectedAlbum, expectedArtist, token) {
  if (!albumId || !/^\d+$/.test(String(albumId))) return null;
  const url = new URL(`${APPLE_CATALOG}/${APPLE_STOREFRONT}/albums/${albumId}`);
  url.searchParams.set('extend', 'editorialVideo');
  const body = await appleCatalogGet(url.href, token);
  const album = body?.data?.[0];
  const attributes = album?.attributes;
  if (!attributes || !motionMatchesArtist(expectedArtist, attributes.artistName)) return null;
  const foundAlbum = motionTitleKey(attributes.name);
  const wantedAlbum = motionTitleKey(expectedAlbum);
  if (wantedAlbum && foundAlbum && foundAlbum !== wantedAlbum && !foundAlbum.includes(wantedAlbum) && !wantedAlbum.includes(foundAlbum)) return null;
  const motion = editorialMotion(attributes.editorialVideo);
  return motion ? { ...motion, album: attributes.name || expectedAlbum || null } : null;
}

/** Find the exact Apple motion canvas for the playing recording, if it has one. */
export async function trackMotionArt({ title, artist, album }) {
  const titleKey = motionTitleKey(title);
  const artistKey = normalizeName(artist);
  const albumKey = motionTitleKey(album);
  if (!titleKey || !artistKey) return null;
  const key = `motion2:${titleKey}|${artistKey}|${albumKey}`;
  return motionCache.resolve(key, async () => {
    const token = await appleCatalogToken();

    // 1. Search for the album via iTunes Search API (which never 429 rate limits)
    const searchTerms = [
      album ? `${artist} ${album}` : null,
      `${artist} ${title}`,
      album || title,
    ].filter(Boolean);

    for (const term of searchTerms) {
      try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5`;
        const res = await safeFetch(itunesUrl, { timeout: 6000 });
        if (!res?.ok) continue;
        const data = await res.json().catch(() => null);
        for (const item of data?.results || []) {
          const albumId = item.collectionId;
          if (!albumId) continue;
          if (!motionMatchesArtist(artist, item.artistName)) continue;
          const foundAlbum = motionTitleKey(item.collectionName);
          const wantedAlbum = motionTitleKey(album);
          if (wantedAlbum && foundAlbum && foundAlbum !== wantedAlbum && !foundAlbum.includes(wantedAlbum) && !wantedAlbum.includes(foundAlbum)) continue;

          // Fetch album editorial video with Apple catalog token
          if (token) {
            const detail = await appleCatalogGet(`${APPLE_CATALOG}/${APPLE_STOREFRONT}/albums/${albumId}?extend=editorialVideo`, token);
            const editorial = detail?.data?.[0]?.attributes?.editorialVideo;
            const motion = editorialMotion(editorial);
            if (motion) return { ...motion, album: item.collectionName || album || null };
          }

          // Fallback: check if webpage has an m3u8 stream
          try {
            const pageRes = await safeFetch(`https://music.apple.com/${APPLE_STOREFRONT}/album/${albumId}`, {
              timeout: 6000,
              headers: { 'User-Agent': UA },
            });
            if (pageRes?.ok) {
              const html = await pageRes.text();
              const m3u8Match = html.match(/https:\/\/[^"']+\.m3u8/i);
              if (m3u8Match) {
                return { url: m3u8Match[0], aspect: 1, album: item.collectionName || album || null };
              }
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    // 2. Legacy catalog search fallback (if token is available and unblocked)
    if (token) {
      try {
        const term = [artist, title, album].filter(Boolean).join(' ');
        const search = new URL(`${APPLE_CATALOG}/${APPLE_STOREFRONT}/search`);
        search.searchParams.set('term', term);
        search.searchParams.set('types', 'songs');
        search.searchParams.set('limit', '10');
        search.searchParams.set('extend', 'editorialVideo');
        search.searchParams.set('include', 'albums');
        const body = await appleCatalogGet(search.href, token);
        const hits = body?.results?.songs?.data || [];
        for (const song of hits) {
          const attributes = song?.attributes;
          if (!attributes || motionTitleKey(attributes.name) !== titleKey) continue;
          if (!motionMatchesArtist(artist, attributes.artistName)) continue;
          const foundAlbum = motionTitleKey(attributes.albumName);
          if (albumKey && foundAlbum && foundAlbum !== albumKey && !foundAlbum.includes(albumKey) && !albumKey.includes(foundAlbum)) continue;
          const inline = editorialMotion(attributes.editorialVideo);
          if (inline) return { ...inline, album: attributes.albumName || album || null };
          const albumId = song.relationships?.albums?.data?.[0]?.id || String(attributes.url || '').match(/\/album\/[^/]+\/(\d+)/)?.[1];
          const motion = await fetchAlbumMotion(albumId, album || attributes.albumName, artist, token);
          if (motion) return motion;
        }
      } catch {
        // ignore
      }
    }

    return null;
  });
}

/**
 * Apple's own music video for the playing recording, if there is one.
 *
 * Apple files a ~30 second preview of every music video under `previews`
 * (a plain mp4 on its own CDN). The song's title must agree with the video's
 * and the artist must share a name — a cover, a live cut or a "making of"
 * with the same words is not the recording that is playing.
 */
const musicVideoCache = new AsyncResolver(new TTLCache({ max: 256, ttl: 24 * 3600_000 }), { ttl: 24 * 3600_000, negativeTtl: 3600_000 });

export function hdVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  return rawUrl;
}

export function videoPreview(video, title) {
  const attributes = video?.attributes;
  const preview = (attributes?.previews || []).find((item) => typeof item?.url === 'string' && /^https?:\/\//i.test(item.url));
  if (!attributes || !preview) return null;
  const width = Number(attributes.artwork?.width);
  const height = Number(attributes.artwork?.height);
  const rawUrl = preview.hlsUrl && /^https?:\/\//i.test(preview.hlsUrl) ? preview.hlsUrl : preview.url;
  return {
    url: hdVideoUrl(rawUrl),
    aspect: width > 0 && height > 0 ? width / height : 16 / 9,
    title: attributes.name || title,
    provider: 'apple',
  };
}

/** What kind of cut a video is, from its own title. null = not a music video at all. */
export function videoLabel(name) {
  const n = String(name || '');
  if (/behind the scenes|making of|\bbts\b|teaser|trailer|interview|reaction|tutorial|dance practice/i.test(n)) return null;
  if (/visuali[sz]er/i.test(n)) return 'Visualizer';
  if (/director'?s?\s*cut/i.test(n)) return "Director's Cut";
  if (/alternate|alternative|\balt\b|extended|uncut|unreleased|version 2|short film|remix/i.test(n)) return 'Alternate Version';
  if (/lyric/i.test(n)) return 'Lyric Video';
  if (/\blive\b|concert|acoustic|unplugged/i.test(n)) return 'Live';
  return 'Music Video';
}
export const LABEL_ORDER = ['Music Video', "Director's Cut", 'Alternate Version', 'Visualizer', 'Live', 'Lyric Video'];

/** Strips artist prefixes, remaster/re-release tails, version descriptors, brackets, and extraneous noise. */
export function cleanTrackTitle(raw, artists = []) {
  let t = String(raw || '').trim();
  const artistList = Array.isArray(artists) ? artists : [artists];
  for (const a of artistList) {
    const artistStr = String(a || '').trim();
    if (!artistStr) continue;
    if (t.toLowerCase().startsWith(artistStr.toLowerCase())) {
      const rest = t.slice(artistStr.length).replace(/^[\s–—\-:|]+/, '');
      if (rest) {
        t = rest;
        break;
      }
    }
  }
  const cleaned = t
    .replace(/\s*[-–—]\s*(?:[0-9]{4}\s*)?(?:remaster(?:ed)?|re-?release|single|version|live|official(?:\s*music)?\s*video|film version|director'?s?\s*cut|extended|alternate|alternative|uncut|hd|4k|mix|deluxe|anniversary|edit|mono|stereo|bonus|acoustic|visuali[sz]er).*$/i, '')
    .replace(/\s*[([](?:from|feat\.?|ft\.?|with|official|audio|video|lyrics?|remaster(?:ed)?|[0-9]{4}\s*remaster|director'?s?\s*cut|extended|alternate|alternative|uncut|visuali[sz]er|hd|4k)[^)\]]*[)\]]/gi, '')
    .trim();
  return cleaned || t;
}

function videoResolutionScore(url) {
  const u = String(url || '');
  if (/\.m3u8/i.test(u)) return 1000;
  if (/1920w|1080/i.test(u)) return 900;
  if (/1280w|720w|720/i.test(u)) return 700;
  if (/640x|640w|480/i.test(u)) return 500;
  return 300;
}

function isMatchingVideoTitle(videoTitle, targetClean, targetTitleKey) {
  const vClean = cleanTrackTitle(videoTitle);
  const vKey = motionTitleKey(vClean);
  if (!vKey || !targetTitleKey) return false;
  return vKey === targetTitleKey || motionTitleKey(videoTitle) === targetTitleKey;
}

/**
 * Every Apple music video that belongs to this song — the official one, its
 * director's cut, an alternate or extended version, visualizer — most official & HD first.
 */
export async function trackMusicVideos({ title, artists = [], album = '', channel = '' }) {
  let list = (Array.isArray(artists) ? artists : [artists]).map((a) => String(a || '').trim()).filter(Boolean);
  const rawTitle = String(title || '');
  const dashMatch = rawTitle.match(/^([^–—\-:|]+)\s*[-–—:|]\s*(.+)$/);
  if (!list.length) {
    if (dashMatch) list = [dashMatch[1].trim()];
    else if (channel) list = [channel.replace(/\s*[-–|]\s*(?:topic|vevo)\s*$/i, '').trim()];
  }
  const bare = cleanTrackTitle(title, list);
  const titleKey = motionTitleKey(bare) || motionTitleKey(title);
  if (!titleKey || !list.length) return [];
  const albumKey = motionTitleKey(cleanTrackTitle(album));
  const cacheKey = `mvs7:${titleKey}|${list.map(normalizeName).sort().join('+')}`;
  return musicVideoCache.resolve(cacheKey, async () => {
    const joined = list.join(', ');
    const terms = [...new Set([
      `${list[0]} ${bare}`,
      bare,
      `${list[0]} ${bare} visualizer`,
      album ? `${bare} ${cleanTrackTitle(album)}` : null,
      list[1] ? `${list[1]} ${bare}` : null,
    ].filter(Boolean))];
    const found = new Map();

    const considerItem = (name, rawUrl, artistName, collectionName, storefront) => {
      if (!rawUrl || !name) return;
      const label = videoLabel(name);
      if (!label) return;
      if (!isMatchingVideoTitle(name, bare, titleKey)) return;
      const sameArtist = motionMatchesArtist(joined, artistName);
      const sameFilm = albumKey && motionTitleKey(cleanTrackTitle(collectionName)) === albumKey;
      if (!sameArtist && !sameFilm) return;
      const finalUrl = hdVideoUrl(rawUrl);
      if (!finalUrl) return;

      const resScore = videoResolutionScore(finalUrl);
      const existing = found.get(finalUrl);
      if (!existing || resScore > (existing.score || 0)) {
        found.set(finalUrl, {
          url: finalUrl,
          aspect: 16 / 9,
          title: name || title,
          label,
          official: label === 'Music Video',
          provider: 'apple',
          storefront,
          score: resScore,
        });
      }
    };

    // 1. iTunes Search API (parallelized across countries and terms for fast ~400ms loading)
    const itunesQueries = [];
    for (const country of ['us', 'in']) {
      for (const term of terms) {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=musicVideo&country=${country}&limit=15`;
        itunesQueries.push(
          safeFetch(itunesUrl, { timeout: 4500 })
            .then(async (res) => {
              if (!res?.ok) return;
              const data = await res.json().catch(() => null);
              for (const item of data?.results || []) {
                considerItem(item.trackName, item.previewUrl, item.artistName, item.collectionName, country);
              }
            })
            .catch(() => null),
        );
      }
    }

    // 2. Apple Music Catalog API in parallel (for direct linked music-videos, adaptive HLS, & visualizers)
    const catalogQuery = (async () => {
      try {
        const token = await appleCatalogToken();
        if (!token) return;
        const catalogFetches = ['us', 'in'].map(async (sf) => {
          const searchUrl = `${APPLE_CATALOG}/${sf}/search?term=${encodeURIComponent(list[0] + ' ' + bare)}&types=songs,music-videos&limit=15&include=music-videos`;
          const body = await appleCatalogGet(searchUrl, token);
          if (!body) return;
          for (const video of body.results?.['music-videos']?.data || []) {
            const hit = videoPreview(video, title);
            if (hit?.url) {
              considerItem(video.attributes?.name, hit.url, video.attributes?.artistName, video.attributes?.albumName, sf);
            }
          }
          for (const song of body.results?.songs?.data || []) {
            const songName = song?.attributes?.name;
            if (!songName || !isMatchingVideoTitle(songName, bare, titleKey)) continue;
            for (const link of (song.relationships?.['music-videos']?.data || []).slice(0, 4)) {
              const detail = await appleCatalogGet(`${APPLE_CATALOG}/${sf}/music-videos/${link.id}`, token);
              const v = detail?.data?.[0];
              const hit = videoPreview(v, title);
              if (hit?.url) {
                considerItem(v?.attributes?.name, hit.url, v?.attributes?.artistName, v?.attributes?.albumName, sf);
              }
            }
          }
        });
        await Promise.allSettled(catalogFetches);
      } catch {
        // ignore
      }
    })();

    await Promise.allSettled([...itunesQueries, catalogQuery]);

    // Deduplicate: keep highest resolution HD version of identical cut,
    // while preserving distinct alternate cuts, visualizers, and live takes.
    const sortedRaw = [...found.values()].sort((a, b) => {
      const orderA = LABEL_ORDER.indexOf(a.label);
      const orderB = LABEL_ORDER.indexOf(b.label);
      if (orderA !== orderB) return orderA - orderB;
      return (b.score || 0) - (a.score || 0);
    });

    const dedupedByCut = new Map();
    for (const v of sortedRaw) {
      const cutKey = `${v.label}|${normalizeName(v.title)}`;
      if (!dedupedByCut.has(cutKey)) {
        dedupedByCut.set(cutKey, v);
      }
    }

    const seenUrls = new Set();
    const out = [];
    for (const v of dedupedByCut.values()) {
      if (!seenUrls.has(v.url)) {
        seenUrls.add(v.url);
        out.push(v);
      }
    }
    return out.length ? out : null;
  });
}

/** The first (official) video only — kept for callers that want one. */
export async function trackMusicVideo({ title, artist }) {
  const videos = await trackMusicVideos({ title, artists: String(artist || '').split(/,|&/).map((a) => a.trim()) }).catch(() => null);
  return videos?.[0] || null;
}

/** The artist page for a name, or null when Apple has no exact match. */
async function findArtistPage(name) {
  const key = normalizeName(name);
  if (!key) return null;
  const res = await safeFetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=8`,
    { timeout: 7000 },
  );
  if (!res) throw new Error('Apple artist lookup timed out');
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Apple artist lookup returned HTTP ${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const results = Array.isArray(body?.results) ? body.results : [];
  for (const r of results) {
    if (normalizeName(r?.artistName) !== key) continue;
    // The link carries the artist's slug; the bare id answers with a redirect
    // to it, one more round trip for the same page.
    const link = String(r.artistLinkUrl || '').split('?')[0];
    if (link) return { link, id: r.artistId || null };
    if (r.artistId) return { link: `https://music.apple.com/us/artist/${r.artistId}`, id: r.artistId };
  }
  return null;
}

/**
 * Fetch Apple's catalog token ahead of time. The token is the slow half of
 * the artist banner lookup and it stays valid for months, so paying for it
 * once at boot means the first artist page gets its banner straight away.
 */
export async function warmAppleCatalog() {
  const token = await appleCatalogToken();
  return !!token;
}

/** The whole lookup, from a name to the banner's parts. */
async function lookup(name) {
  // The catalog token is fetched while Apple's search answers, so the two
  // slow halves of this lookup happen at the same time rather than in turn.
  const tokenPromise = appleCatalogToken();
  const page = await findArtistPage(name);
  if (!page) return null;

  // Apple's catalogue API answers with three kilobytes of JSON, and the
  // photograph in it is the artist's own picture — cropped to fill, at any
  // size. The banner does not wait for the artist's page.
  const hero = await artistHero(page.id, tokenPromise);
  if (hero) {
    // The page carries the typeset name, the motion clip and, for some
    // artists, a wider picture. It is worth the wait, but not the banner's.
    void enrichWithPage(name, page.link, hero);
    return { ...hero, transient: true };
  }
  return artistPageArt(page.link);
}

/**
 * Fetch the artist's page for its wide artwork, logo and clip, and fold them
 * into the cached banner. The first caller gets the photograph straight
 * away; the next one gets the richer picture.
 */
async function enrichWithPage(name, link, base) {
  try {
    const pageArt = await artistPageArt(link);
    if (!pageArt) return;
    const key = normalizeName(name);
    const merged = {
      ...base,
      ...pageArt,
      // The page has no wide artwork of its own for many artists; the
      // photograph is their banner, and it stays.
      banner: pageArt.banner || base.banner || null,
      bannerAspect: pageArt.bannerAspect || base.bannerAspect || null,
      hero: pageArt.banner || base.banner || pageArt.hero || base.hero || null,
      heroAspect: pageArt.bannerAspect || base.bannerAspect || pageArt.heroAspect || base.heroAspect || null,
      wide: pageArt.wide || base.wide || null,
      wideAspect: pageArt.wideAspect || base.wideAspect || null,
      name: pageArt.name || base.name || null,
      keyColor: pageArt.keyColor || base.keyColor || null,
      transient: false,
    };
    cache.set(key, merged, cache.ttl);
  } catch {
    // The photograph is already on screen; the logo and clip are a bonus.
  }
}

/** The artist's own page, when it answers. Its logo and clip are worth the wait. */
async function artistPageArt(link) {
  try {
    const res = await safeFetch(link, { timeout: 9000, headers: { 'User-Agent': UA } });
    if (!res || !res.ok) return null;
    const html = await res.text();
    return parseArtistPage(html);
  } catch {
    // The page is the slow half of this lookup. Failing it must not take the
    // catalog's hero down with it.
    return null;
  }
}

/**
 * The hero photograph and Apple's own colours, from the catalog API.
 * This is the fast path: one small JSON response instead of a whole page.
 *
 * The `bb` crop is the photograph itself — Apple fills the frame with it —
 * while the social image for the same asset is the picture cut into a
 * circle. The banner wants the photograph, cut to fill.
 */
async function artistHero(artistId, tokenPromise) {
  if (!artistId) return null;
  const token = await (tokenPromise || appleCatalogToken());
  if (!token) return null;
  const url = new URL(`${APPLE_CATALOG}/${APPLE_STOREFRONT}/artists/${artistId}`);
  url.searchParams.set('extend', 'hero');
  const body = await appleCatalogGet(url.href, token);
  const attributes = body?.data?.[0]?.attributes;
  const artwork = attributes?.hero?.[0]?.content?.[0]?.artwork || attributes?.artwork;
  if (!artwork?.url) return null;
  const width = Number(artwork.width) || 0;
  const height = Number(artwork.height) || 0;
  const banner = imageAtWidth(artwork, BANNER_WIDTH, 1, 'webp');
  if (!banner) return null;
  return {
    name: attributes?.name || null,
    // The photograph, cut to fill: the banner stretches it across the page.
    banner,
    bannerAspect: width > 0 && height > 0 ? width / height : 1,
    hero: banner,
    heroAspect: width > 0 && height > 0 ? width / height : 1,
    square: banner,
    wide: null,
    wideAspect: null,
    logo: null,
    logoAspect: 0,
    motion: null,
    preview: null,
    widePreview: null,
    wideMotion: null,
    background: hexColor(artwork.bgColor) || null,
    accent: hexColor(artwork.textColor1) || null,
  };
}

/** The header art on an artist's Apple page. */
function parseArtistPage(html) {
  const marker = html.indexOf('id="serialized-server-data"');
  if (marker < 0) return null;
  const start = html.indexOf('>', marker) + 1;
  const end = html.indexOf('</script>', start);
  if (start <= 0 || end < 0) return null;

  let root;
  try {
    root = JSON.parse(`{"d":${html.slice(start, end)}}`).d;
  } catch {
    return null;
  }
  const header = findHeader(root);
  if (!header) return null;

  const logo = header.artistLogo?.dictionary;
  const wide = header.wideArtwork?.dictionary;
  const still = (header.artwork || header.colorBackdropArtwork)?.dictionary;
  if (!still && !wide && !logo) return null;

  const logoW = logo?.width || 0;
  const logoH = logo?.height || 0;
  const logoUrl = logo && logoW > 0 && logoH > 0 ? fillTemplate(logo.url, LOGO_WIDTH, Math.round((LOGO_WIDTH * logoH) / logoW), 'png') : null;

  // The wide artwork is the banner when the artist has one: it was cut by
  // Apple to fill the top of their page. Otherwise the photograph itself is
  // the banner, and it stretches across the page.
  const wideUrl = imageAtWidth(wide, WIDE_WIDTH, 16 / 9, 'webp');
  const photoUrl = imageAtWidth(still, BANNER_WIDTH, 1, 'webp');
  const bannerUrl = wideUrl || photoUrl;
  const bannerAspect = wide?.width > 0 && wide?.height > 0
    ? wide.width / wide.height
    : still?.width > 0 && still?.height > 0
      ? still.width / still.height
      : 1;

  const wideMotion = motionFrom(header.wideVideoArtwork);
  const squareMotion = motionFrom(header.videoArtwork);

  // The clip is a different picture from the still, with its own colours —
  // the page has to match whichever one is on screen.
  const colours = wideMotion
    ? header.wideVideoArtwork?.dictionary?.motionArtistWide16x9?.previewFrame
      || header.wideVideoArtwork?.dictionary?.motionArtistFullscreen16x9?.previewFrame
    : squareMotion
      ? header.videoArtwork?.dictionary?.motionArtistSquare1x1?.previewFrame
      : null;

  return {
    // Apple's own name for the artist, as it typeset it on the page.
    name: header.title || null,
    // The banner picture: the photograph, cut to fill.
    banner: bannerUrl,
    bannerAspect,
    hero: bannerUrl,
    heroAspect: bannerAspect,
    square: photoUrl,
    wide: wideUrl,
    wideAspect: wide?.width > 0 && wide?.height > 0 ? wide.width / wide.height : null,
    logo: logoUrl,
    logoAspect: logoUrl ? logoW / logoH : 0,
    // Artist heroes are wide. Prefer the matching wide clip and preview so
    // the video does not letterbox or crop Apple's square motion artwork.
    motion: wideMotion?.video || squareMotion?.video || null,
    preview: wideMotion?.preview || squareMotion?.preview || null,
    widePreview: wideMotion?.preview || null,
    wideMotion: wideMotion?.video || null,
    background: hexColor(colours?.bgColor) || hexColor(wide?.bgColor) || hexColor(still?.bgColor) || null,
    accent: hexColor(colours?.textColor1) || hexColor(wide?.textColor1) || hexColor(still?.textColor1) || null,
    // The colour Apple fills the artist's Play button with.
    keyColor: hexColor(header.keyColor) || null,
  };
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

const cache = new TTLCache({ max: 128, ttl: 24 * 3600_000 });
/** An artist Apple has nothing for: remembered for an hour, not a day. */
const EMPTY_TTL = 3600_000;
const inFlight = new Map();

/**
 * The banner for an artist, or null. Never throws, and never asks Apple
 * twice for the same name at the same time.
 */
export async function artistArt(name) {
  const key = normalizeName(name);
  if (!key) return null;

  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = (async () => {
    let art = null;
    try {
      art = await lookup(name);
    } catch (err) {
      console.warn('[apple] artist art failed for', name, err?.message || err);
      // A network error is not proof that Apple has no art. Do not cache it as
      // a miss; a later request can recover as soon as Apple's edge responds.
      throw err;
    }
    cache.set(key, art, art ? cache.ttl : EMPTY_TTL);
    return art;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

export async function appleCuratedPlaylists() {
  const token = await appleCatalogToken();
  if (!token) return [];
  try {
    const res = await appleCatalogGet(
      `https://amp-api.music.apple.com/v1/catalog/${APPLE_STOREFRONT}/charts?types=playlists&limit=15`,
      token
    );
    const rawList = res?.results?.playlists?.[0]?.data || [];
    return rawList
      .map((p) => {
        const art = p.attributes?.artwork?.url;
        const thumb = art ? art.replace('{w}x{h}', '600x600') : null;
        return {
          id: p.id,
          title: p.attributes?.name || 'Apple Playlist',
          subtitle: p.attributes?.curatorName || 'Apple Music',
          thumb,
          source: 'apple',
          kind: 'playlist',
        };
      })
      .filter((p) => p.id && p.title && p.thumb);
  } catch (err) {
    console.warn('[apple] failed to fetch curated playlists:', err?.message || err);
    return [];
  }
}