/**
 * yt.js — Official YouTube Music Synchronized Lyrics Provider.
 *
 * Implements native Android Music client context resolution:
 * 1. Calls /next on YouTube Music to extract the lyrics browseId (MUSIC_PAGE_TYPE_TRACK_LYRICS).
 * 2. Browses the endpoint as ANDROID_MUSIC (v7.21.50) to receive exact timedLyricsData.
 * 3. Maps millisecond start and end time ranges for 100% accurate lyrics sync.
 * 4. Fallback to official timed caption tracks if timedLyricsData is unavailable.
 */

import { getYT } from '../../yt.js';
import { lineSynced, makeLine, syl } from '../model.js';
import { cleanTitle } from '../text.js';
import { isThisSong } from '../verify.js';

const ANDROID_MUSIC_VERSION = '7.21.50';

/**
 * YouTube Music only serves its timed lyrics to the phone app: the web client
 * is answered with the plain description shelf. youtubei.js's own
 * `YTMUSIC_ANDROID` client is pinned to 5.34.51, which YouTube now rejects, so
 * this asks with a current Android Music context instead.
 */
async function browseAsAndroidMusic(yt, browseId) {
  const session = yt.session;
  const context = {
    ...session.context,
    client: {
      ...session.context.client,
      clientName: 'ANDROID_MUSIC',
      clientVersion: ANDROID_MUSIC_VERSION,
      clientFormFactor: 'SMALL_FORM_FACTOR',
      androidSdkVersion: 33,
      osName: 'Android',
      osVersion: '13',
      platform: 'MOBILE',
      userAgent: `com.google.android.apps.youtube.music/${ANDROID_MUSIC_VERSION} (Linux; U; Android 13) gzip`,
    },
  };
  delete context.client?.configInfo;
  delete context.client?.browserName;
  delete context.client?.browserVersion;

  const url = `https://music.youtube.com/youtubei/v1/browse?alt=json&prettyPrint=false&key=${encodeURIComponent(session.api_key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, browseId }),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * Locate the Lyrics tab's browseId from a watch-next response.
 */
function findLyricsBrowseId(node) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const id = findLyricsBrowseId(child);
      if (id) return id;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const supported = node.browseEndpointContextSupportedConfigs;
  const music = supported?.browseEndpointContextMusicConfig;
  if (typeof node.browseId === 'string' && music?.pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS') {
    return node.browseId;
  }
  for (const value of Object.values(node)) {
    const id = findLyricsBrowseId(value);
    if (id) return id;
  }
  return null;
}

/** First array named [name] anywhere in [node], depth-first. */
function findArray(node, name) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findArray(child, name);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node[name])) return node[name];
  for (const val of Object.values(node)) {
    const found = findArray(val, name);
    if (found) return found;
  }
  return null;
}

/**
 * Parse YouTube Music's timedLyricsData into timed line models.
 */
function parseTimedLyricsData(data) {
  const entries = findArray(data, 'timedLyricsData');
  if (!entries || !entries.length) return null;

  const lines = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const text = typeof entry.lyricLine === 'string' ? entry.lyricLine.trim() : '';
    // Skip empty lines or pure musical intro notes
    if (!text || text === '♪') continue;

    const cue = entry.cueRange && typeof entry.cueRange === 'object' ? entry.cueRange : {};
    const start = Number(cue.startTimeMilliseconds);
    const end = Number(cue.endTimeMilliseconds);
    if (!Number.isFinite(start)) continue;

    const endMs = Number.isFinite(end) && end > start ? end : start + 3200;
    lines.push(lineSynced(text, start, endMs));
  }

  // Sort by start time to guarantee strictly monotonic cue progression
  lines.sort((a, b) => a.timestamp - b.timestamp);
  return lines.length >= 4 ? lines : null;
}

/**
 * Fallback: signed timedtext JSON3 caption extraction.
 */
async function parseCaptionTrack(baseUrl, io) {
  if (!baseUrl) return null;
  const res = await io.json(`${baseUrl}&fmt=json3`, { timeout: 4500 }).catch(() => null);
  const rawEvents = (res?.events || []).filter((e) => e.segs && e.tStartMs != null);
  if (rawEvents.length < 4) return null;

  const lines = [];
  for (const e of rawEvents) {
    const start = e.tStartMs;
    const end = start + (e.dDurationMs || 3000);
    const segs = e.segs || [];
    const text = segs.map((s) => s.utf8 || '').join('').trim();
    if (!text || text === '\n') continue;

    const hasWordOffsets = segs.length > 1 && segs.some((s) => s.tOffsetMs != null);
    if (hasWordOffsets) {
      const words = [];
      for (let si = 0; si < segs.length; si++) {
        const s = segs[si];
        const wText = s.utf8 || '';
        if (!wText.trim() && wText !== ' ') continue;
        const wStart = start + (s.tOffsetMs || 0);
        const nextSeg = segs[si + 1];
        const wEnd = nextSeg?.tOffsetMs != null ? start + nextSeg.tOffsetMs : end;
        words.push(syl(wText, wStart, Math.max(wStart, wEnd), { part: !/\s$/.test(wText) }));
      }
      if (words.length > 0) {
        lines.push(makeLine({ text: words, timestamp: start, endtime: end, isWordSynced: true }));
        continue;
      }
    }

    lines.push(lineSynced(text, start, end));
  }

  return lines.length >= 4 ? lines : null;
}

async function getCaptionTracks(yt, videoId) {
  let tracks = [];
  try {
    const info = await yt.getInfo(videoId, 'WEB');
    tracks = info?.captions?.caption_tracks || [];
  } catch {}

  if (!tracks.length) {
    try {
      const player = await yt.actions.execute('/player', { videoId, client: 'WEB' });
      tracks = player?.data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch {}
  }

  return tracks;
}

function pickBestCaptionTrack(captionTracks) {
  if (!captionTracks || !captionTracks.length) return null;
  const chosen =
    captionTracks.find((t) => t.kind !== 'asr' && (t.language_code === 'en' || t.language_code === 'hi')) ||
    captionTracks.find((t) => t.kind !== 'asr') ||
    captionTracks.find((t) => t.language_code === 'en' || t.language_code === 'hi') ||
    captionTracks[0];

  return chosen?.base_url || chosen?.baseUrl || null;
}

export default {
  id: 'yt',
  label: 'YouTube Music',
  async run(ctx, io) {
    try {
      const yt = await getYT();
      let videoId = ctx.videoId;

      // If no videoId provided, search for official track
      if (!videoId && ctx.title) {
        const hits = await yt.searchSongs(`${cleanTitle(ctx.title)} ${ctx.artist || ''}`.trim(), 3).catch(() => []);
        if (hits[0]?.id) videoId = hits[0].id;
      }

      // 1. Native YouTube Music Timed Lyrics extraction
      if (videoId) {
        try {
          const watch = await yt.actions.execute('/next', { videoId, client: 'YTMUSIC', parse: false });
          const browseId = findLyricsBrowseId(watch?.data);
          if (browseId) {
            const data = await browseAsAndroidMusic(yt, browseId);
            const timed = parseTimedLyricsData(data);
            if (timed && timed.length >= 4) {
              return {
                lines: timed,
                source: 'YouTube Music',
              };
            }
          }
        } catch {}

        // 2. Official Timed Captions extraction (backup for art tracks / MVs)
        const tracks = await getCaptionTracks(yt, videoId);
        const baseUrl = pickBestCaptionTrack(tracks);
        if (baseUrl) {
          const lines = await parseCaptionTrack(baseUrl, io);
          if (lines) {
            return {
              lines,
              source: 'YouTube Music',
            };
          }
        }
      }

      // 3. Search for official lyric video captions
      if (ctx.title) {
        const query = `${cleanTitle(ctx.title)} ${ctx.artist || ''} official lyric video`.trim();
        const search = await yt.search(query, { type: 'video' }).catch(() => null);
        const candidates = search?.videos || search?.results || [];

        for (const cand of candidates.slice(0, 3)) {
          const candDur = cand.duration?.seconds || cand.durationSec || 0;
          if (ctx.duration && candDur && Math.abs(candDur - ctx.duration) > 14) continue;
          const candObj = {
            title: cand.title?.text || cand.title || '',
            artist: cand.author?.name || cand.channel?.name || '',
            durationSec: candDur || null,
          };
          if (!isThisSong(candObj, ctx)) continue;

          const candTracks = await getCaptionTracks(yt, cand.id);
          const baseUrl = pickBestCaptionTrack(candTracks);
          if (baseUrl) {
            const lines = await parseCaptionTrack(baseUrl, io);
            if (lines) {
              return {
                lines,
                source: 'YouTube Music',
              };
            }
          }
        }
      }
    } catch {
      return null;
    }

    // Never return un-timed plain text with 0 timestamps
    return null;
  },
};
