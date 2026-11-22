/**
 * LRCLIB — an open lyrics database: whole-line sync, and always up.
 *
 * Exact match first (needs the duration), then the structured search, then looser text searches for
 * credits that were filed under one name of several. Every result passes the recording matcher: same-title,
 * different-song uploads are rife on community databases.
 */

import { parseLrc, parsePlain } from '../parse/lrc.js';
import { normWords, simWords } from '../text.js';
import { sharesArtist } from '../../match.js';
import { isThisSong } from '../verify.js';

const BASE = 'https://lrclib.net/api';
const HEADERS = { 'User-Agent': 'VYUNE/2.0 (lyrics lookup)' };
const ask = (io, path) => io.json(`${BASE}${path}`, { timeout: 5000, headers: HEADERS, retryBusy: true });

/** A record → { lines, synced }. Synced lines win; plain is the fallback inside the same record. */
function fromRecord(record) {
  if (!record) return null;
  const meta = { title: record.trackName || record.name || null, artist: record.artistName || null };
  const timed = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  if (timed.length) return { lines: timed, synced: true, meta };
  const plain = record.plainLyrics ? parsePlain(record.plainLyrics) : [];
  return plain.length ? { lines: plain, synced: false, meta } : null;
}

async function candidates(ctx, io) {
  const { title, artist, album } = ctx;
  const artists = String(artist || '')
    .split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const structured = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) structured.set('album_name', album);
  let found = await ask(io, `/search?${structured}`);
  if (Array.isArray(found) && found.length) return found;

  found = await ask(io, `/search?${new URLSearchParams({ q: `${artist} ${title}` })}`);
  if (Array.isArray(found) && found.length) return found;

  // Indian and collaborative releases credit several names; LRCLIB often files under one of them
  for (const a of artists) {
    if (a && a !== artist) {
      found = await ask(io, `/search?${new URLSearchParams({ track_name: title, artist_name: a })}`);
      if (Array.isArray(found) && found.length) return found;

      found = await ask(io, `/search?${new URLSearchParams({ q: `${a} ${title}` })}`);
      if (Array.isArray(found) && found.length) return found;
    }
  }

  found = await ask(io, `/search?${new URLSearchParams({ q: title })}`);
  if (Array.isArray(found) && found.length) return found;

  return [];
}

/** { lines, synced, meta } for this song, or null. */
export async function lookupLrclib(ctx, io) {
  if (!ctx.title || !ctx.artist) return null;
  const artists = String(ctx.artist)
    .split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (ctx.duration) {
    const dStr = String(Math.round(ctx.duration));
    const params = new URLSearchParams({ track_name: ctx.title, artist_name: ctx.artist, duration: dStr });
    if (ctx.album) params.set('album_name', ctx.album);
    const exact = fromRecord(await ask(io, `/get?${params}`));
    if (exact) return exact;

    // Try individual artists for collaborative tracks
    for (const a of artists) {
      if (a && a !== ctx.artist) {
        const aParams = new URLSearchParams({ track_name: ctx.title, artist_name: a, duration: dStr });
        const aExact = fromRecord(await ask(io, `/get?${aParams}`));
        if (aExact) return aExact;
      }
    }
  }
  const pool = (await candidates(ctx, io))
    .map((x) => {
      const cand = { title: x.trackName || x.name || '', artist: x.artistName || '', durationSec: x.duration || null, album: x.albumName || null };
      if (!isThisSong(cand, ctx)) return null;
      const off = ctx.duration ? Math.abs((x.duration || 0) - ctx.duration) : 0;
      const score = (sharesArtist(ctx.artist, cand.artist) ? 2 : 0) + simWords(normWords(ctx.title), normWords(cand.title)) + (off <= 10 ? 1 : off <= 25 ? 0.6 : 0.2);
      return { x, score, off };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!pool.length) return null;
  const near = ctx.duration ? pool.filter((c) => c.off <= 6) : pool;
  const pick = (near.length ? near : pool).find((c) => c.x.syncedLyrics) || (near[0] || pool[0]);
  return fromRecord(pick.x);
}

export default {
  id: 'lrclib',
  label: 'LRCLIB',
  async run(ctx, io) {
    const found = await lookupLrclib(ctx, io);
    // Words with no timing belong to the fallback, which spreads an estimated timing over them.
    return found?.synced ? { lines: found.lines, meta: found.meta } : null;
  },
};
