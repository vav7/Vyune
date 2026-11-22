/**
 * Unison — a community-submitted lyrics database.
 */

import { parseLrc } from '../parse/lrc.js';
import { parseTTML } from '../parse/ttml.js';
import { isThisSong } from '../verify.js';

export default {
  id: 'unison',
  label: 'Unison',
  async run(ctx, io) {
    if (!ctx.title || !ctx.artist) return null;
    const params = new URLSearchParams({ song: ctx.title, artist: ctx.artist });
    if (ctx.album) params.set('album', ctx.album);
    if (ctx.duration) params.set('duration', String(Math.round(ctx.duration)));
    const data = await io.json(`https://unison.boidu.dev/lyrics?${params}`, { timeout: 6000 });
    const entry = data?.success ? data.data : null;
    if (!entry) return null;

    // Verify candidate identity
    if (entry.song && !isThisSong({ title: entry.song, artist: entry.artist || '', album: entry.album || null }, ctx)) {
      return null;
    }

    const text = typeof entry?.lyrics === 'string' ? entry.lyrics : '';
    if (!text.trim()) return null;
    if (String(entry.format).toLowerCase() === 'ttml') {
      const parsed = parseTTML(text);
      return parsed?.lines?.length ? { lines: parsed.lines, songwriters: parsed.songwriters } : null;
    }
    // Words with no timing are not a timed sheet: the fallback owns those.
    if (String(entry.syncType).toLowerCase() === 'plain') return null;
    const lines = parseLrc(text);
    return lines.length ? { lines } : null;
  },
};
