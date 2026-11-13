/**
 * NetEase Cloud Music, direct and keyless: YRC (word-timed) when it has it, LRC otherwise.
 * One search per song, shared by this provider and the AMLL lookup.
 */

import { TTLCache } from '../../cache.js';
import { parseLrc } from '../parse/lrc.js';
import { parseYrc } from '../parse/karaoke.js';
import { normKey } from '../text.js';
import { isThisSong } from '../verify.js';

const HEADERS = { Referer: 'https://music.163.com/' };
const finds = new TTLCache({ max: 200, ttl: 30 * 60_000 });

/** The NetEase song that is this recording, or null. Memoised: the promise is cached, so concurrent callers share it. */
export function neteaseFind(ctx, io) {
  const key = `${normKey(ctx.title)}|${normKey(ctx.artist || '')}|${Math.round(ctx.duration || 0)}`;
  const hit = finds.get(key);
  if (hit) return hit;
  const pending = (async () => {
    const keyword = ctx.artist ? `${ctx.title} ${ctx.artist}` : ctx.title;
    const data = await io.json(
      `https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=8`,
      { timeout: 5000, headers: HEADERS },
    );
    const songs = Array.isArray(data?.result?.songs) ? data.result.songs : [];
    return (
      songs.find((s) =>
        isThisSong(
          { title: s.name, artist: (s.artists || []).map((a) => a.name).join(', '), durationSec: s.duration ? s.duration / 1000 : null },
          ctx,
        ),
      ) || null
    );
  })();
  finds.set(key, pending);
  return pending;
}

export default {
  id: 'netease',
  label: 'NetEase',
  async run(ctx, io) {
    if (!ctx.title) return null;
    const found = await neteaseFind(ctx, io);
    if (!found) return null;
    const data = await io.json(`https://music.163.com/api/song/lyric?id=${found.id}&lv=-1&kv=-1&tv=-1&yv=-1`, { timeout: 5000, headers: HEADERS });
    const word = typeof data?.yrc?.lyric === 'string' ? parseYrc(data.yrc.lyric) : [];
    if (word.length) return { lines: word };
    const line = typeof data?.lrc?.lyric === 'string' ? parseLrc(data.lrc.lyric) : [];
    return line.length ? { lines: line } : null;
  },
};
