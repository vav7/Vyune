/**
 * SimpMusic — community synced lyrics provider from SimpMusic.
 *
 * Direct, zero-config integration with api-lyrics.simpmusic.org.
 * Supports rich word-synced lyrics (richSyncLyrics) and standard LRC line sync (syncedLyrics).
 */

import { parsePayload } from '../parse/envelope.js';
import { parseLrc } from '../parse/lrc.js';
import { isThisSong } from '../verify.js';
import { cleanArtist, cleanTitle } from '../text.js';

const BASE = 'https://api-lyrics.simpmusic.org/v1';
const HEADERS = {
  'User-Agent': 'SimpMusic/2.0.0 (Linux; Android 14; Mobile; rv:120.0)',
  Accept: 'application/json, text/plain, */*',
  'X-Client': 'SimpMusic',
};

function parseItem(item, ctx) {
  if (!item) return null;

  const cand = {
    title: item.songTitle || item.title || '',
    artist: item.artistName || item.artist || '',
    durationSec: Number(item.durationSeconds || item.duration) || null,
    album: item.albumName || item.album || null,
  };

  if (cand.title && !isThisSong(cand, ctx)) return null;

  // 1. Try word-synced richSyncLyrics first
  if (typeof item.richSyncLyrics === 'string' && item.richSyncLyrics.trim()) {
    try {
      const parsed = parsePayload(item.richSyncLyrics);
      if (parsed?.lines?.length && parsed.lines.some((l) => l.isWordSynced || l.timestamp > 0)) {
        return {
          lines: parsed.lines,
          songwriters: parsed.songwriters || undefined,
        };
      }
    } catch {
      // Fall through to standard syncedLyrics
    }
  }

  // 2. Try line-synced syncedLyrics (LRC)
  if (typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim()) {
    const lines = parseLrc(item.syncedLyrics);
    if (lines?.length) {
      return { lines };
    }
  }

  return null;
}

export default {
  id: 'simpmusic',
  label: 'SimpMusic',
  async run(ctx, io) {
    if (!ctx.title || !ctx.artist) return null;

    // 1. Query by videoId directly if available
    if (ctx.videoId) {
      try {
        const item = await io.json(`${BASE}/${encodeURIComponent(ctx.videoId)}`, {
          timeout: 4000,
          headers: HEADERS,
        });
        const direct = item?.data ? (Array.isArray(item.data) ? item.data[0] : item.data) : item;
        const res = parseItem(direct, ctx);
        if (res?.lines?.length) return res;
      } catch {
        // Fall back to search
      }
    }

    // 2. Search by song title & artist
    const queries = [
      `${cleanTitle(ctx.title) || ctx.title} ${cleanArtist(ctx.artist) || ctx.artist}`.trim(),
      `${ctx.title} ${ctx.artist}`.trim(),
    ];

    for (const q of queries) {
      if (!q) continue;
      try {
        const data = await io.json(`${BASE}/search?q=${encodeURIComponent(q)}&limit=5`, {
          timeout: 4000,
          headers: HEADERS,
        });

        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        for (const item of list) {
          const res = parseItem(item, ctx);
          if (res?.lines?.length) return res;
        }
      } catch {
        // Continue
      }
    }

    return null;
  },
};
