/**
 * lrc.red — Apple Music timings, filed by ISRC.
 *
 * `/s/{ISRC}.song.json` carries the TTML *and* the plain line text; `/s/{ISRC}.ttml` is the bare
 * document. A known recording costs one request and cannot come back as the wrong edit. Without an
 * ISRC the catalogue is searched by name and every hit is judged by the strict matcher: its free-text
 * search happily ranks "Bohemian Rhapsody (Operatic Section)" above the song.
 */

import { lineSynced, makeLine, syl, toMs } from '../model.js';
import { cleanIsrc } from '../text.js';
import { parseTTML } from '../parse/ttml.js';
import { respaced } from '../shape.js';
import { bestHit, isThisSong } from '../verify.js';

const BASE = 'https://lrc.red';

/** The song.json lyrics block (no TTML inside) → lines. */
function linesFromJson(song) {
  const entries = song?.lyrics?.lines;
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const line of entries) {
    if (typeof line?.text !== 'string' || !line.text.trim()) continue;
    const timestamp = toMs(line.begin);
    const endtime = toMs(line.end, timestamp);
    const timed = song.lyrics.sync === 'word' && Array.isArray(line.words) && line.words.length > 0;
    if (!timed) {
      out.push({ ...lineSynced(line.text, timestamp, endtime), oppositeTurn: line.voice === 'b', agentId: line.voice });
      continue;
    }
    const parts = line.words.flatMap((word, wi) =>
      Array.isArray(word)
        ? word.map((s, si) => {
            const part = si < word.length - 1;
            const space = !part && wi < line.words.length - 1 ? ' ' : '';
            return syl(`${s.text || ''}${space}`, toMs(s.begin, timestamp), toMs(s.end, endtime), { part });
          })
        : [],
    );
    if (!parts.length) continue;
    out.push(makeLine({
      text: respaced(parts, line.text), // provider segments by akshara; the plain line holds the true spaces
      oppositeTurn: line.voice === 'b',
      agentId: line.voice,
      timestamp,
      endtime,
      isWordSynced: true,
    }));
  }
  return out;
}

async function byIsrc(isrc, io) {
  const song = await io.json(`${BASE}/s/${isrc}.song.json`, { timeout: 5000 });
  if (song) {
    const parsed = typeof song.source === 'string' ? parseTTML(song.source) : null;
    let lines = parsed?.lines?.length ? parsed.lines : linesFromJson(song);
    if (lines.length) {
      if (parsed?.lines?.length && Array.isArray(song.lyrics?.lines)) {
        const plain = song.lyrics.lines.map((l) => (typeof l?.text === 'string' ? l.text : ''));
        lines = lines.map((l, i) => {
          const text = plain[i] ? respaced(l.text, plain[i]) : l.text;
          return text === l.text ? l : { ...l, text };
        });
      }
      return {
        lines,
        isrc,
        byModel: song.byModel === true,
        songwriters: Array.isArray(song.songwriters) ? song.songwriters.join(', ') : parsed?.songwriters,
      };
    }
  }
  // The bare document: same catalogue, no plain text to re-space from.
  const ttml = await io.text(`${BASE}/s/${isrc}.ttml`, { timeout: 5000 });
  const parsed = ttml ? parseTTML(ttml) : null;
  return parsed?.lines?.length ? { lines: parsed.lines, isrc, songwriters: parsed.songwriters } : null;
}

/** Ask by name. Duration is a hint, not a filter: catalogues disagree by seconds. */
async function search(ctx, io) {
  const { title, artist, album, duration } = ctx;
  const probe = (d) => {
    const params = new URLSearchParams({ track: title, artist });
    if (album) params.set('album', album);
    if (d) params.set('duration', String(d));
    return io.json(`${BASE}/match.json?${params}`);
  };
  const d0 = Math.round(duration || 0);
  const accept = (hit) =>
    cleanIsrc(hit?.isrc) &&
    isThisSong(
      { title: hit.title || hit.trackName || hit.track_name || '', artist: hit.artist || hit.artist_name || '', durationSec: Number(hit.duration) || null, album: hit.album || null },
      ctx,
    );
  const firstHits = (await probe(d0))?.hits;
  let hits = Array.isArray(firstHits) ? firstHits : [];
  if (!hits.some(accept)) {
    const more = await Promise.all([
      ...(d0 ? [probe(d0 - 4), probe(d0 + 4)] : []),
      probe(0),
      io.json(`${BASE}/search.json?${new URLSearchParams({ q: `${title} ${artist}`.trim() })}`),
    ]);
    hits = more.flatMap((r) => (Array.isArray(r?.hits) ? r.hits : []));
  }
  const exact = hits.slice(0, 6).find(accept);
  const strict = exact || bestHit(hits, ctx, { accept: (h) => !!cleanIsrc(h?.isrc) });
  return strict ? cleanIsrc(strict.isrc) : null;
}

export default {
  id: 'lrc.red',
  label: 'lrc.red',
  needsRecording: true,
  async run(ctx, io, env) {
    const known = cleanIsrc(ctx.isrc) || cleanIsrc(env?.recording?.isrc);
    if (known) {
      const sheet = await byIsrc(known, io);
      if (sheet) return sheet;
    }
    if (!ctx.title || !ctx.artist) return null;
    const found = await search(ctx, io);
    return found && found !== known ? byIsrc(found, io) : null;
  },
};
