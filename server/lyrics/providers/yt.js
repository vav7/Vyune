/**
 * yt.js — YouTube Official Synced Lyrics & Caption Provider.
 *
 * Accurate timing extraction:
 *  1. Direct extraction of signed timedtext captions from YouTube via WEB client / player.
 *  2. If the current playback is an art-track without captions, looks up the official
 *     music video / lyric video and extracts its timed captions.
 *  3. Parses exact millisecond start, duration, and syllable/word-level offsets from JSON3 events.
 *  4. NEVER returns 0-timestamp plain text as timed lyrics (preventing inaccurate estimation).
 */

import { getYT } from '../../yt.js';
import { lineSynced, makeLine, syl } from '../model.js';
import { cleanTitle } from '../text.js';
import { isThisSong } from '../verify.js';

/**
 * Fetch signed timedtext JSON3 and parse into accurately timed lines.
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

    // Check if word-level offsets exist
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

/**
 * Extract caption tracks from a videoId using Innertube WEB client or Player endpoint.
 */
async function getCaptionTracks(yt, videoId) {
  let tracks = [];
  try {
    const info = await yt.getInfo(videoId, 'WEB');
    tracks = info?.captions?.caption_tracks || [];
  } catch {
    /* try player */
  }

  if (!tracks.length) {
    try {
      const player = await yt.actions.execute('/player', { videoId, client: 'WEB' });
      tracks = player?.data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch {
      /* ignore */
    }
  }

  return tracks;
}

function pickBestCaptionTrack(captionTracks) {
  if (!captionTracks || !captionTracks.length) return null;
  // Prioritize manual / official captions over ASR, prioritizing common/original languages
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

      // 1. If videoId provided, attempt caption extraction directly
      if (videoId) {
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

      // 2. If videoId had no captions (e.g. YouTube Music art track) or no videoId,
      // search YouTube for official lyric video or music video that carries accurate timed captions
      if (ctx.title) {
        const queries = [
          `${cleanTitle(ctx.title)} ${ctx.artist || ''} official lyric video`.trim(),
          `${cleanTitle(ctx.title)} ${ctx.artist || ''} lyric video`.trim(),
          `${cleanTitle(ctx.title)} ${ctx.artist || ''} official video`.trim(),
        ];

        for (const q of queries) {
          const search = await yt.search(q, { type: 'video' }).catch(() => null);
          const candidates = search?.videos || search?.results || [];

          for (const cand of candidates.slice(0, 4)) {
            const candDur = cand.duration?.seconds || cand.durationSec || 0;
            // Verify candidate song identity and duration agreement
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
      }
    } catch {
      return null;
    }

    // Do NOT return un-timed plain text with 0 timestamps. Accurate timing only.
    return null;
  },
};
