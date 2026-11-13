/**
 * saavn.js — JioSaavn client (direct; no third-party wrapper, talks to api.php directly).
 *
 * Verified flow (2026):
 *   search.getResults / song.getDetails → more_info.encrypted_media_url
 *   → DES-ECB decrypt (key "38346591") via crypto-js (OpenSSL 3 dropped DES)
 *   → CDN URL: the encrypted URL normally names the 96 kbps file, and the
 *     catalogue states per track whether a parallel 320 kbps object exists
 *   → direct aac.saavncdn.com URL supports HTTP Range → streamable in <audio>.
 *
 * JioSaavn is the reliable fallback when YouTube refuses the server IP
 * ("Sign in to confirm you're not a bot" on datacenter ranges).
 */

import CryptoJS from 'crypto-js';
import { safeFetch, UA } from './cache.js';
import { parseDuration } from './yt.js';
import {
  CREDIT_OVERRIDE_SEC,
  hasConflictingAlbums,
  queries as matchQueries,
  ranked,
  sharesArtist,
  uniquelyMostCreditedCloseMatch,
  withinSeconds,
} from './match.js';

const API = 'https://www.jiosaavn.com/api.php';

/**
 * The shnwazdev JioSaavn wrapper (https://github.com/shnwazdev/shnwazdev-jiosaavn-api):
 * a Hono API that already does the DES decrypt and hands back every CDN
 * rendition up to 320 kbps. It is asked FIRST for search, details and the
 * stream; the direct api.php path below stays as the fallback, so a wrapper
 * outage (or a self-hosted instance that is down) never silences playback.
 * Point SAAVN_WRAPPER_URL at your own deployment to avoid the public one.
 * Set SAAVN_WRAPPER=off to skip it entirely.
 */
const WRAPPER_BASE = (process.env.SAAVN_WRAPPER_URL || 'https://jio.shnwaz.dev').replace(/\/+$/, '');
const WRAPPER_ON = process.env.SAAVN_WRAPPER !== 'off';
let wrapperDownUntil = 0;

async function wrapperGet(path, timeout = 6000) {
  if (!WRAPPER_ON || Date.now() < wrapperDownUntil) return null;
  const res = await safeFetch(`${WRAPPER_BASE}${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout,
  });
  if (!res) {
    // Network failure: stop asking for a minute rather than add a timeout to every track.
    wrapperDownUntil = Date.now() + 60_000;
    return null;
  }
  if (!res.ok) return null;
  try {
    const j = await res.json();
    return j?.success === false ? null : (j?.data ?? j);
  } catch {
    return null;
  }
}

const kbpsOf = (q) => parseInt(String(q || '').replace(/[^0-9]/g, ''), 10) || 0;

/** A wrapper song row as the normalized track the rest of the server expects. */
function mapWrapperTrack(t) {
  if (!t?.id) return null;
  const artistsRaw = t.artists?.primary || t.artists?.all || t.primaryArtists || [];
  const artists = (Array.isArray(artistsRaw)
    ? artistsRaw.map((a) => (typeof a === 'string' ? a : a?.name))
    : String(artistsRaw).split(',')
  )
    .map((a) => stripTags(String(a || '')))
    .filter(Boolean);
  const images = Array.isArray(t.image) ? t.image : [];
  const bestImage = images.length ? images[images.length - 1]?.url || images[images.length - 1]?.link : typeof t.image === 'string' ? t.image : null;
  const streams = (Array.isArray(t.downloadUrl) ? t.downloadUrl : [])
    .map((d) => ({ kbps: kbpsOf(d.quality), url: d.url || d.link }))
    .filter((d) => d.url && /^https?:\/\//.test(d.url))
    .sort((a, b) => b.kbps - a.kbps);
  return {
    id: String(t.id),
    source: 'saavn',
    title: stripTags(t.name || t.title || ''),
    artists,
    album: stripTags(typeof t.album === 'string' ? t.album : t.album?.name || '') || null,
    duration: parseInt(t.duration || '0', 10) || 0,
    thumb: upscaledImage(bestImage),
    explicit: t.explicitContent === true || t.explicitContent === 'true' || t.explicit_content === '1',
    year: t.year ? parseInt(t.year, 10) || null : null,
    playCount: parseInt(t.playCount || t.play_count || '0', 10) || 0,
    language: t.language || null,
    lyrics: null,
    has320: streams.some((x) => x.kbps >= 320),
    encrypted: null,
    streams,
  };
}

/**
 * The Indian residential address headers. Akamai
 * in front of both api.php and the CDN answers some datacenter ranges with a
 * 403 or an HTML hiccup page; these headers are what keeps the catalogue and
 * the CDN answering, along with the explicit-content cookie that otherwise
 * silently drops every uncensored row from search.
 */
const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  'X-Forwarded-For': '49.36.0.1',
  'X-Real-IP': '49.36.0.1',
  'Accept-Language': 'en-IN,en;q=0.9',
  Cookie: 'explicit_content=1',
};

/* ---------------- DES decrypt (pure JS) ---------------- */

const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

function decryptMediaUrl(encrypted) {
  if (!encrypted) return null;
  try {
    const dec = CryptoJS.DES.decrypt(encrypted, DES_KEY, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.NoPadding,
    }).toString(CryptoJS.enc.Utf8);
    // DES NoPadding leaves the PKCS-style pad bytes (\x01..\x08 / NUL) on the tail
    return dec.replace(/[\x00-\x1f]+$/g, '').trim() || null;
  } catch {
    return null;
  }
}

/* ---------------- helpers ---------------- */

function stripTags(s = '') {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function upscaledImage(img) {
  if (!img) return null;
  // saavn serves -50x50/-150x150/...; ask for the 500x500 variant
  return String(img).replace(/-(50x50|150x150|500x500)(\.\w+)?$/, '') + '-500x500.jpg';
}

export function mapSaavnTrack(t) {
  const mi = t.more_info || {};
  // The credit arrives in three shapes: a structured artist map, a plain
  // `primary_artists` list, or the single `music` string the chart and
  // trending feeds use.
  const primary =
    mi.artistMap?.primary_artists?.map((a) => a.name).filter(Boolean) ||
    (mi.primary_artists
      ? String(mi.primary_artists).split(',').map((s) => s.trim()).filter(Boolean)
      : mi.music
        ? String(mi.music).split(',').map((s) => s.trim()).filter(Boolean)
        : []);
  const artists = primary.length
    ? primary
    : t.subtitle
      ? t.subtitle.split(' - ')[0].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const has320 = mi['320kbps'] === 'true' || mi['320kbps'] === true;
  return {
    id: t.id,
    source: 'saavn',
    title: stripTags(t.title),
    artists,
    album: stripTags(mi.album || '') || null,
    duration: parseInt(mi.duration || '0', 10) || parseDuration(mi.duration),
    thumb: upscaledImage(t.image),
    explicit: t.explicit_content === '1' || t.explicit_content === 1 || mi.explicit_content === '1',
    year: t.year ? parseInt(t.year, 10) || null : null,
    playCount: parseInt(t.play_count || '0', 10) || 0,
    language: t.language || null,
    // The catalogue's own lyrics, when it has any. JioSaavn's public API
    // leaves this empty for most rows, but the field is part of the payload
    // and the lyrics engine asks for it before it falls back to YouTube.
    lyrics: typeof t.lyrics === 'string' ? t.lyrics : null,
    has320,
    encrypted: mi.encrypted_media_url || null,
  };
}

/**
 * Put uncensored catalogue rows ahead of their clean duplicates (`prioritizeExplicit`):
 * with the explicit-content cookie set, a track the
 * label filed both ways comes back twice, and the clean row is not the one
 * the listener asked for.
 */
function prioritizeExplicit(tracks) {
  return tracks.slice().sort((a, b) => Number(!!b.explicit) - Number(!!a.explicit));
}

/* ---------------- public API ---------------- */

/** Search JioSaavn. Returns normalized tracks, uncensored rows first. */
export async function saavnSearch(query, limit = 15) {
  const viaWrapper = await wrapperGet(`/api/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`);
  const rows = viaWrapper?.results || (Array.isArray(viaWrapper) ? viaWrapper : []);
  const mapped = rows.map(mapWrapperTrack).filter((t) => t && t.title);
  if (mapped.length) return prioritizeExplicit(mapped);
  return saavnSearchDirect(query, limit);
}

async function saavnSearchDirect(query, limit = 15) {
  const params = new URLSearchParams({
    __call: 'search.getResults',
    p: '1',
    q: query,
    _format: 'json',
    _marker: '0',
    api_version: '4',
    ctx: 'android',
    n: String(limit),
  });
  // Akamai occasionally serves an HTML hiccup page — one retry fixes it
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await safeFetch(`${API}?${params}`, { headers: HEADERS, timeout: 8000 });
    if (!res || !res.ok) continue;
    try {
      const j = await res.json();
      const out = (j.results || []).map(mapSaavnTrack).filter((t) => t.id && t.title);
      if (out.length || attempt === 1) return prioritizeExplicit(out);
    } catch {
      /* HTML/edge response — retry */
    }
  }
  return [];
}

/** Full details for a saavn track id (needed when search payload lacks media url). */
export async function saavnDetails(saavnId) {
  if (!saavnId) return null;
  const viaWrapper = await wrapperGet(`/api/songs/${encodeURIComponent(saavnId)}`);
  const row = Array.isArray(viaWrapper) ? viaWrapper[0] : viaWrapper?.results?.[0] ?? viaWrapper?.songs?.[0] ?? viaWrapper;
  const mapped = row && typeof row === 'object' ? mapWrapperTrack(row) : null;
  if (mapped?.streams?.length) return mapped;
  return saavnDetailsDirect(saavnId);
}

async function saavnDetailsDirect(saavnId) {
  const params = new URLSearchParams({
    __call: 'song.getDetails',
    pids: saavnId,
    _format: 'json',
    _marker: '0',
    api_version: '4',
    ctx: 'android',
  });
  const res = await safeFetch(`${API}?${params}`, { headers: HEADERS, timeout: 8000 });
  if (!res || !res.ok) return null;
  try {
    const j = await res.json();
    // The shape moved. The details call used to answer { songs: [ … ] }; it now
    // answers { "<pid>": { … } } — a map keyed by the id that was asked for.
    // Reading only `songs[0]` made every lookup null, and with it the whole
    // JioSaavn streaming path: the catalogue matched, then the media URL was
    // never fetched, and playback fell through to a YouTube URL that this
    // network can only read the first megabyte of.
    const t = j?.songs?.[0] ?? j?.[saavnId] ?? (j && typeof j === 'object' ? Object.values(j)[0] : null);
    return t ? mapSaavnTrack(t) : null;
  } catch {
    return null;
  }
}

/**
 * Select the highest JioSaavn CDN rendition without losing URL parameters
 * (`selectBestSaavnStream`). CDN URLs are not guaranteed to end at
 * `.mp4`: cache-busting or access query parameters may follow it. An
 * end-anchored match misses those URLs, leaves `_96.mp4` in place, and still
 * reports 320 upstream — so the rewrite is anchored on a lookahead instead,
 * and is conditional on the catalogue actually stating a 320 rendition.
 * Asking the CDN for `_320` anyway does not produce one.
 *
 * @returns {{url: string, kbps: number|null}} the URL and the rate it really serves
 */
export function selectBestSaavnStream(decryptedUrl, supports320) {
  if (!decryptedUrl) return { url: decryptedUrl, kbps: null };
  const re = /_(48|96|160|320)\.(mp4|aac|mp3)(?=[?#]|$)/i;
  const m = re.exec(decryptedUrl);
  // An unrecognised URL must not be labelled 320 merely because the catalogue
  // says that rendition exists; no rewrite was actually made.
  if (!m) return { url: decryptedUrl, kbps: null };
  const offered = parseInt(m[1], 10);
  if (!supports320) return { url: decryptedUrl, kbps: offered };
  return {
    url: decryptedUrl.slice(0, m.index) + `_320.${m[2]}` + decryptedUrl.slice(m.index + m[0].length),
    kbps: 320,
  };
}

/**
 * Resolve a streamable audio URL for a saavn track.
 * @param {object} track normalized saavn track (must have id)
 * @returns {Promise<{url:string, bitrate:number|null}|null>}
 */
export async function saavnStreamUrl(track) {
  let t = track;
  if (!t?.streams?.length && !t?.encrypted) t = await saavnDetails(track?.id);
  if (!t) return null;

  // The wrapper's own renditions, best first. Each is probed: a rendition the
  // catalogue lists but the CDN does not serve is skipped, not returned.
  if (t.streams?.length) {
    for (const stream of t.streams.slice(0, 3)) {
      const r = await safeFetch(stream.url, { headers: { ...HEADERS, Range: 'bytes=0-0' }, timeout: 6000 });
      if (r && (r.status === 200 || r.status === 206)) {
        return { url: stream.url, bitrate: stream.kbps ? stream.kbps * 1000 : null };
      }
    }
    // None answered: the direct path may still know the track.
    t = await saavnDetailsDirect(track?.id);
  }
  if (!t?.encrypted) return null;

  const decrypted = decryptMediaUrl(t.encrypted);
  if (!decrypted || !/^https?:\/\//.test(decrypted)) return null;

  const chosen = selectBestSaavnStream(decrypted, t.has320);
  const probe = async (url) => {
    const r = await safeFetch(url, { headers: { ...HEADERS, Range: 'bytes=0-0' }, timeout: 6000 });
    return r && (r.status === 200 || r.status === 206) ? r : null;
  };

  if (await probe(chosen.url)) return { url: chosen.url, bitrate: chosen.kbps ? chosen.kbps * 1000 : null };
  // The rewritten rendition can 404 on a catalogue that lied about it: fall
  // back to whatever the encrypted URL named, and say what that really is.
  if (chosen.url !== decrypted && (await probe(decrypted))) {
    const original = selectBestSaavnStream(decrypted, false);
    return { url: decrypted, bitrate: original.kbps ? original.kbps * 1000 : null };
  }
  return null;
}

/* ---------------- matching ---------------- */

/**
 * Listings that are not the recording at all, however well the title reads:
 * karaoke and tribute product. match.js already refuses version markers on one
 * side only ("Karaoke", "Instrumental", "Cover"); these are the phrases that
 * carry no marker word in the title, only in a subtitle or album.
 */
const NOT_THE_SONG =
  /karaoke|tribute|originally performed|as made famous|made famous by|in the style of|string quartet|lullaby|\bcover of\b|performance group/i;

/** A normalized track as a match.js candidate. */
function asCandidate(t) {
  return {
    title: t.title,
    artist: (t.artists || []).join(', '),
    durationSec: t.duration || null,
    album: t.album || null,
    isExplicit: t.explicit ?? null,
  };
}

/**
 * Find the saavn row that is genuinely the same recording.
 *
 * Ask the catalogue the way the
 * catalogue files things (packaging off, artist as a second query, the other
 * script as a third), score every answer rather than taking the search
 * engine's first row, and refuse to guess when the catalogue holds two
 * different recordings under one title and artist.
 *
 * @param {string} title  the title as the queue knows it (decorated is fine)
 * @param {string} artist credited artists, joined
 * @param {{album?:string, duration?:number, canonTitle?:string, canonArtist?:string, isVideo?:boolean}} extra
 * @returns {Promise<object|null>} the normalized saavn track, or null
 */
export async function findSaavnMatch(title, artist, extra = {}) {
  const target = {
    title,
    artist: artist || extra.canonArtist || '',
    durationSec: extra.duration > 0 ? Math.round(extra.duration) : null,
    album: extra.album || null,
    isExplicit: null,
    isVideo: !!extra.isVideo,
  };

  // Best query first. The identity engine's canonical title gets its own pair
  // when it differs — a label-credited upload's decorated title and the
  // catalogue's plain one are both worth asking.
  const wanted = [target];
  if (extra.canonTitle && extra.canonTitle !== title) {
    wanted.push({ ...target, title: extra.canonTitle, artist: artist || extra.canonArtist || '' });
  }
  const ordered = [...new Set(wanted.flatMap((t) => matchQueries(t)))];

  for (const query of ordered) {
    const results = await saavnSearch(query, 10);
    if (!results.length) continue;
    const eligible = results.filter((t) =>
      (t.encrypted || t.streams?.length) &&
      !NOT_THE_SONG.test(t.title) &&
      !NOT_THE_SONG.test(t.album || '') &&
      // An exact runtime is not proof that a same-title result is the same
      // recording. Require the catalog row to credit the requested artist.
      (!target.artist || sharesArtist(target.artist, (t.artists || []).join(', '))),
    );
    if (!eligible.length) continue;

    // ranked() preserves the objects it is given, so each candidate carries
    // its saavn row back out on `.track`.
    const candidates = eligible.map((t) => ({ ...asCandidate(t), track: t }));
    let matches = ranked(candidates, target);
    if (!matches.length) continue;

    // A runtime that agrees to the second proves the same master (the
    // matcher's own doctrine: a cover, a remix or a re-recording essentially
    // never lands there) — the same recording re-issued on a compilation is
    // not a conflict about the audio, so the best exact-runtime row wins.
    // Here JioSaavn is the last resort and a
    // refusal is silence, so only a genuine runtime-ambiguous collision is.
    const exact = matches.filter((c) => withinSeconds(c, target, CREDIT_OVERRIDE_SEC));
    if (exact.length) return exact[0].track;

    // JioSaavn has catalogue collisions where title and artist are identical
    // but the audio is not. With no album on the requested track there is no
    // honest way to choose between those rows; duration is not enough when the
    // wrong recording is only a second away. Treat it as a miss unless one row
    // is plainly the fuller credit — and keep the known-correct fallback.
    if (hasConflictingAlbums(matches, target)) {
      // YouTube Music artist rows often omit both album and duration. When the
      // catalogue's exact-title, exact-artist releases all have the same
      // runtime, they are reissues of the same recording; rejecting them all
      // falls through to a Google Video URL that may only serve its first
      // range on this network, causing audible pauses during playback.
      if (!target.durationSec) {
        const runtimes = matches.map((candidate) => candidate.durationSec).filter((value) => Number.isFinite(value) && value > 0);
        if (runtimes.length === matches.length && Math.max(...runtimes) - Math.min(...runtimes) <= 2) {
          return matches[0].track;
        }
      }
      const canonical = uniquelyMostCreditedCloseMatch(matches, target);
      if (!canonical) {
        // A search row carries no album, so an album-page row of the same song
        // plays while this one used to be refused. Refusing is silence when
        // YouTube cannot answer, so choose the closest runtime (else the
        // top-ranked row) unless SAAVN_STRICT=1 asks for the old behaviour.
        if (process.env.SAAVN_STRICT === '1') continue;
        const byRuntime = [...matches].sort((a, b) => {
          if (!target.durationSec) return 0;
          return Math.abs((a.durationSec || 1e6) - target.durationSec) - Math.abs((b.durationSec || 1e6) - target.durationSec);
        });
        return byRuntime[0].track;
      }
      matches = [canonical];
    }
    return matches[0].track;
  }
  return null;
}
