/**
 * lyrics/ — the lyrics engine's public face.
 *
 *   GET /api/lyrics?title=&artist=&album=&duration=&videoId=&channel=&isrc=&q=[&source=][&refresh=1]
 *
 * See engine.js for how a lookup runs and providers/ for where the words come from.
 * The wire format is the client's contract (web/src/lib/types.ts: LyricsResult).
 */

import { withTimeout } from '../cache.js';
import { answers, book, BUDGET, fetchLyrics } from './engine.js';

const text = (c, name) => String(c.req.query(name) || '').trim();

export function registerLyricsRoutes(app) {
  app.get('/api/lyrics', async (c) => {
    const title = text(c, 'title');
    const videoId = text(c, 'videoId');
    const source = text(c, 'source');
    if (!title && !videoId) return c.json({ error: 'title (or videoId) required' }, 400);

    const seconds = parseFloat(c.req.query('duration') || '0');
    const params = {
      title,
      artist: text(c, 'artist'),
      album: text(c, 'album') || undefined,
      duration: seconds > 0 ? seconds : undefined,
      videoId: videoId || undefined,
      channel: text(c, 'channel') || undefined,
      isrc: text(c, 'isrc') || undefined,
      q: text(c, 'q') || undefined,
    };
    try {
      const out = await withTimeout(
        fetchLyrics(params, { refresh: c.req.query('refresh') === '1', forceSource: source || null }),
        BUDGET.response,
        null,
      );
      // A named provider with nothing for this song is not the same as no provider having anything:
      // the panel says so and offers the engine's best answer instead of an empty column.
      return c.json(out || (source ? { status: 'none', alternates: [], negative: true, reason: 'source', source } : { status: 'none', alternates: [], negative: true }));
    } catch (err) {
      console.error('[lyrics] route error:', err.message);
      return c.json({ error: 'lyrics_failed' }, 500);
    }
  });
}

/** Caches worth keeping across restarts (see persistCaches). */
export const lyricsPersist = () => ({ lyrics: answers.cache, lyricSheets: book });
