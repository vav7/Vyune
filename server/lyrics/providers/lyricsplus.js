/**
 * LyricsPlus — multi-mirror Apple Music & Spotify word-synced lyrics provider.
 *
 * Direct, zero-config integration across resilient community mirrors.
 * Supports rich syllable-level word sync (type: "Word") and line sync (type: "Line").
 */

import { lineSynced, makeLine, syl } from '../model.js';
import { respaced } from '../shape.js';
import { cleanArtist, cleanTitle } from '../text.js';
import { isThisSong } from '../verify.js';

const MIRRORS = [
  'https://lyricsplus.binimum.org/v2/lyrics/get',
  'https://lyricsplus.prjktla.my.id/v2/lyrics/get',
  'https://lyricsplus.atomix.one/v2/lyrics/get',
  'https://lyricsplus.prjktla.workers.dev/v2/lyrics/get',
];

function parseLyricsPlus(data, ctx) {
  if (!data || !Array.isArray(data.lyrics) || data.lyrics.length === 0) return null;

  // Verify song match if metadata is returned
  if (data.metadata?.title) {
    const cand = {
      title: data.metadata.title,
      artist: data.metadata.artist || '',
      album: data.metadata.album || null,
    };
    if (!isThisSong(cand, ctx)) return null;
  }

  const isWord = String(data.type || '').toLowerCase() === 'word';
  const lines = [];

  for (const line of data.lyrics) {
    if (!line) continue;
    const timestamp = Number(line.time) || 0;
    const endtime = timestamp + (Number(line.duration) || 0);
    const oppositeTurn = line.element?.singer === 'v2';

    if (isWord && Array.isArray(line.syllabus) && line.syllabus.length > 0) {
      const parts = line.syllabus.map((s, idx) => {
        const sStart = Number(s.time) || timestamp;
        const sEnd = sStart + (Number(s.duration) || 0);
        const text = String(s.text ?? '');
        const part = idx < line.syllabus.length - 1 && !/\s$/.test(text);
        return syl(text, sStart, sEnd, { part });
      });

      lines.push(
        makeLine({
          text: respaced(parts, line.text || ''),
          oppositeTurn,
          timestamp,
          endtime,
          isWordSynced: true,
        }),
      );
    } else if (line.text && String(line.text).trim()) {
      lines.push({
        ...lineSynced(String(line.text), timestamp, endtime),
        oppositeTurn,
      });
    }
  }

  if (!lines.length) return null;

  return {
    lines,
    isrc: data.metadata?.isrc || undefined,
    songwriters: Array.isArray(data.metadata?.songWriters)
      ? data.metadata.songWriters.join(', ')
      : data.metadata?.songWriters || undefined,
  };
}

async function fetchFromMirror(url, query, io) {
  const p = new URLSearchParams(query);
  const data = await io.json(`${url}?${p}`, { timeout: 3500 });
  return data;
}

export default {
  id: 'lyricsplus',
  label: 'LyricsPlus',
  async run(ctx, io) {
    if (!ctx.title || !ctx.artist) return null;

    const queries = [
      { title: cleanTitle(ctx.title) || ctx.title, artist: cleanArtist(ctx.artist) || ctx.artist },
      { title: ctx.title, artist: ctx.artist },
    ];

    for (const q of queries) {
      if (!q.title || !q.artist) continue;

      // Race available mirrors concurrently to achieve lowest latency and failover resilience
      try {
        const fetchPromises = MIRRORS.map((mirror) =>
          fetchFromMirror(mirror, q, io).then((data) => {
            const parsed = parseLyricsPlus(data, ctx);
            if (parsed?.lines?.length) return parsed;
            throw new Error('No lyrics');
          }),
        );

        const winner = await Promise.any(fetchPromises);
        if (winner?.lines?.length) return winner;
      } catch {
        // Fall through to next query variation
      }
    }

    return null;
  },
};
