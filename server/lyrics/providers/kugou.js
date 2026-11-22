/**
 * KuGou, direct — word-timed KRC when it decodes, plain LRC timing otherwise. Strong outside the
 * English catalogue.
 *
 * Two routes to the same lyric record:
 *  1. by recording: song search → hashes whose length is within 8 s of the playing track,
 *     closest first → the lyric search by hash. A cover or a remix has a different length, so this
 *     cannot hand back the wrong cut;
 *  2. by name: the lyric search with "artist - title" and the duration, each candidate judged by the
 *     matcher.
 */

import { parseLrc } from '../parse/lrc.js';
import { decodeKrc, parseKrc } from '../parse/karaoke.js';
import { cleanTitle } from '../text.js';
import { isThisSong } from '../verify.js';

const DURATION_TOLERANCE_SEC = 8;
const base64Text = (b64) => Buffer.from(b64, 'base64').toString('utf8');

async function byRecording(ctx, io) {
  const keywords = [
    [ctx.title, ctx.artist].filter(Boolean).join(' - '),
    cleanTitle(ctx.title),
  ].filter(Boolean);

  const seconds = Math.round(ctx.duration || 0);

  for (const keyword of keywords) {
    const data = await io.json(
      `https://mobileservice.kugou.com/api/v3/search/song?${new URLSearchParams({ version: '9108', plat: '0', pagesize: '8', showtype: '0', keyword })}`,
      { timeout: 5000 },
    );
    const hashes = (data?.data?.info || [])
      .filter((s) => s?.hash && (!seconds || Math.abs((s.duration || 0) - seconds) <= DURATION_TOLERANCE_SEC))
      .filter((s) => isThisSong({ title: s.songname || s.filename || '', artist: s.singername || '', durationSec: s.duration }, ctx))
      .sort((a, b) => Math.abs((a.duration || 0) - seconds) - Math.abs((b.duration || 0) - seconds))
      .slice(0, 3);
    for (const { hash } of hashes) {
      const found = await io.json(`https://lyrics.kugou.com/search?${new URLSearchParams({ ver: '1', man: 'yes', client: 'pc', hash })}`, { timeout: 5000 });
      const candidate = (found?.candidates || []).find((c) =>
        c?.id && c?.accesskey && (!c.song || isThisSong({ title: c.song, artist: c.singer || '', durationSec: c.duration ? c.duration / 1000 : null }, ctx))
      );
      if (candidate) return candidate;
    }
  }
  return null;
}

async function byName(ctx, io) {
  const cleanT = cleanTitle(ctx.title);
  const ms = ctx.duration ? Math.round(ctx.duration * 1000) : '';
  const queries = [
    ctx.artist ? `${ctx.artist} - ${ctx.title}` : null,
    cleanT,
  ].filter(Boolean);

  for (const keyword of queries) {
    const data = await io.json(
      `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(keyword)}&duration=${ms}&hash=`,
      { timeout: 5000 },
    );
    const candidates = (data?.candidates || []).filter((c) => c?.id && c?.accesskey).slice(0, 6);
    const hit = candidates.find((c) =>
      isThisSong({ title: c.song || '', artist: c.singer || '', durationSec: c.duration ? c.duration / 1000 : null }, ctx)
    );
    if (hit) return hit;
  }
  return null;
}

async function download(candidate, fmt, io) {
  const url = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=${fmt}&charset=utf8`;
  const body = await io.json(url, { timeout: 5000 });
  return body?.status === 200 && body.content ? body.content : null;
}

export default {
  id: 'kugou',
  label: 'KuGou',
  async run(ctx, io) {
    if (!ctx.title) return null;
    const candidate = (await byRecording(ctx, io)) || (await byName(ctx, io));
    if (!candidate) return null;
    const [krc, lrc] = await Promise.all([download(candidate, 'krc', io), download(candidate, 'lrc', io)]);
    if (krc) {
      try {
        const lines = parseKrc(decodeKrc(krc), ctx.title);
        if (lines.length) return { lines };
      } catch {
        // an undecodable KRC falls through to the plain LRC
      }
    }
    const lines = lrc ? parseLrc(base64Text(lrc)) : [];
    return lines.length ? { lines } : null;
  },
};
