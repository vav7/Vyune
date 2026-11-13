/**
 * AMLL TTML DB — a community, hand-checked database of word-by-word lyrics with timed background
 * vocals (adlibs), filed under a song's Apple Music and NetEase ids. A public GitHub repo, keyless;
 * when it has a song it is the best-formatted sheet there is.
 */

import { parseTTML } from '../parse/ttml.js';
import { isThisSong } from '../verify.js';
import { neteaseFind } from './netease.js';

const RAW = 'https://raw.githubusercontent.com/Steve-xmh/amll-ttml-db/main';

async function sheet(dir, id, io) {
  const ttml = await io.text(`${RAW}/${dir}/${id}.ttml`, { timeout: 4500 });
  const parsed = ttml ? parseTTML(ttml) : null;
  return parsed?.lines?.length ? { lines: parsed.lines, songwriters: parsed.songwriters } : null;
}

async function appleId(ctx, io) {
  const term = encodeURIComponent(`${ctx.title} ${ctx.artist || ''}`.trim());
  const data = await io.json(`https://itunes.apple.com/search?term=${term}&entity=song&limit=6`, { timeout: 4500 });
  const hit = (data?.results || []).find((x) =>
    isThisSong({ title: x.trackName, artist: x.artistName, durationSec: x.trackTimeMillis ? x.trackTimeMillis / 1000 : null }, ctx),
  );
  return hit?.trackId || null;
}

export default {
  id: 'amll',
  label: 'AMLL',
  async run(ctx, io) {
    if (!ctx.title) return null;
    const [apple, ncm] = await Promise.all([
      appleId(ctx, io).then((id) => (id ? sheet('am-lyrics', id, io) : null)).catch(() => null),
      neteaseFind(ctx, io).then((s) => (s?.id ? sheet('ncm-lyrics', s.id, io) : null)).catch(() => null),
    ]);
    return apple || ncm;
  },
};
