/**
 * yt.js — YouTube & YouTube Music Official Synced Lyrics Provider.
 *
 * Direct integration with YouTube's official captions and YouTube Music:
 *  1. YouTube Timed Text / Captions: fetches signed timedtext captions (English, Hindi,
 *     original audio language) and converts them to precise time-stamped lyrics.
 *  2. YouTube Music Official Lyrics: queries YouTube Music's licensed Musixmatch lyrics
 *     as an authoritative fallback.
 */

import { getYT, getYTMusicLyrics } from '../../yt.js';
import { lineSynced, makeLine, syl } from '../model.js';
import { parsePlain } from '../parse/lrc.js';
import { isThisSong } from '../verify.js';

export default {
  id: 'yt',
  label: 'YouTube Music',
  async run(ctx, io) {
    try {
      const yt = await getYT();
      let videoId = ctx.videoId;

      // If videoId is not provided, search YouTube for the official track
      if (!videoId && ctx.title) {
        const query = `${ctx.title} ${ctx.artist || ''}`.trim();
        const searchRes = await yt.music.search(query, { type: 'song' }).catch(() => null);
        const item = searchRes?.contents?.[0]?.contents?.[0];
        if (item?.id) {
          const cand = {
            title: item.title || '',
            artist: (item.artists || []).map((a) => a.name).join(', '),
            durationSec: item.duration?.seconds || null,
          };
          if (isThisSong(cand, ctx)) {
            videoId = item.id;
          }
        }
      }

      if (!videoId) return null;

      // 1. Try extracting YouTube Timed Text captions
      const info = await yt.getInfo(videoId).catch(() => null);
      const captionTracks = info?.captions?.caption_tracks || [];

      if (captionTracks.length > 0) {
        // Prefer manual / official captions over ASR, prioritizing English and Hindi or original
        const chosen =
          captionTracks.find((t) => t.kind !== 'asr' && (t.language_code === 'en' || t.language_code === 'hi')) ||
          captionTracks.find((t) => t.kind !== 'asr') ||
          captionTracks.find((t) => t.language_code === 'en' || t.language_code === 'hi') ||
          captionTracks[0];

        if (chosen?.base_url) {
          const res = await io.json(`${chosen.base_url}&fmt=json3`, { timeout: 4500 });
          const events = (res?.events || []).filter((e) => e.segs && e.tStartMs != null);

          if (events.length >= 4) {
            const lines = [];
            for (const e of events) {
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
                  if (!wText.trim()) continue;
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

            if (lines.length >= 4) {
              return {
                lines,
                source: 'YouTube Music',
              };
            }
          }
        }
      }

      // 2. Fallback to YouTube Music official lyrics (plain)
      const plainText = await getYTMusicLyrics(videoId);
      if (plainText && plainText.trim()) {
        const plainLines = parsePlain(plainText);
        if (plainLines.length >= 4) {
          return {
            lines: plainLines,
            source: 'YouTube Music',
          };
        }
      }
    } catch {
      return null;
    }

    return null;
  },
};
