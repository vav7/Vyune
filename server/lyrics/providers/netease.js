/**
 * NetEase Cloud Music, direct and keyless: YRC (word-timed) when it has it, LRC otherwise.
 * One search per song, shared by this provider and the AMLL lookup.
 */

import https from 'node:https';
import { TTLCache } from '../../cache.js';
import { parseLrc } from '../parse/lrc.js';
import { parseYrc } from '../parse/karaoke.js';
import { cleanTitle, normKey } from '../text.js';
import { isThisSong } from '../verify.js';

const NETEASE_VIP = '103.135.240.78';
const NETEASE_HEADERS = {
  Host: 'music.163.com',
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

const finds = new TTLCache({ max: 200, ttl: 30 * 60_000 });

/**
 * Fetch a NetEase JSON API endpoint reliably worldwide.
 * Bypasses local ISP DNS poisoning / blackholes (such as in India) by connecting
 * to NetEase's primary international VIP with SNI serverName: 'music.163.com'.
 */
export async function neteaseGetJson(path) {
  if (typeof Bun !== 'undefined') {
    try {
      const res = await fetch(`https://${NETEASE_VIP}${path}`, {
        headers: NETEASE_HEADERS,
        tls: { serverName: 'music.163.com', rejectUnauthorized: false },
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) return await res.json();
    } catch {
      // Fall through to https.request
    }
  }

  return new Promise((resolve) => {
    const req = https.request(
      {
        host: NETEASE_VIP,
        port: 443,
        path,
        method: 'GET',
        servername: 'music.163.com',
        headers: NETEASE_HEADERS,
        rejectUnauthorized: false,
        timeout: 4500,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/** The NetEase song that is this recording, or null. Memoised: the promise is cached, so concurrent callers share it. */
export function neteaseFind(ctx, io) {
  const key = `${normKey(ctx.title)}|${normKey(ctx.artist || '')}|${Math.round(ctx.duration || 0)}`;
  const hit = finds.get(key);
  if (hit) return hit;
  const pending = (async () => {
    const keyword = ctx.artist ? `${ctx.title} ${ctx.artist}` : ctx.title;
    // Use cloudsearch/pc which returns unencrypted results worldwide (unlike deprecated search/get/web)
    let data = await neteaseGetJson(
      `/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=8`,
    );
    let songs = Array.isArray(data?.result?.songs) ? data.result.songs : [];
    let match = songs.find((s) => {
      const artists = (s.ar || s.artists || []).map((a) => a.name).join(', ');
      const durationSec = s.dt ? s.dt / 1000 : s.duration ? s.duration / 1000 : null;
      return isThisSong(
        { title: s.name, artist: artists, durationSec },
        ctx,
      );
    });
    if (match) return match;

    // Fallback: search clean title
    if (ctx.artist) {
      data = await neteaseGetJson(
        `/api/cloudsearch/pc?s=${encodeURIComponent(cleanTitle(ctx.title))}&type=1&offset=0&limit=8`,
      );
      songs = Array.isArray(data?.result?.songs) ? data.result.songs : [];
      match = songs.find((s) => {
        const artists = (s.ar || s.artists || []).map((a) => a.name).join(', ');
        const durationSec = s.dt ? s.dt / 1000 : s.duration ? s.duration / 1000 : null;
        return isThisSong(
          { title: s.name, artist: artists, durationSec },
          ctx,
        );
      });
      if (match) return match;
    }

    return null;
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
    const data = await neteaseGetJson(`/api/song/lyric?id=${found.id}&lv=-1&kv=-1&tv=-1&yv=-1`);
    const word = typeof data?.yrc?.lyric === 'string' ? parseYrc(data.yrc.lyric) : [];
    if (word.length) return { lines: word };
    const line = typeof data?.lrc?.lyric === 'string' ? parseLrc(data.lrc.lyric) : [];
    return line.length ? { lines: line } : null;
  },
};
