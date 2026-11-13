/**
 * globalcharts.js — region-free global top tracks.
 *
 * YouTube's charts browse is IP-locked (datacenter SG → "Trending 20
 * Singapore"), so the global list comes from the public iTunes top-songs RSS
 * (no key, worldwide mainstream) and each entry is resolved to a playable
 * YouTube Music track server-side, cached for 6h.
 */

import { TTLCache, AsyncResolver, safeFetch } from './cache.js';
import * as yt from './yt.js';

const cache = new AsyncResolver(new TTLCache({ max: 4, ttl: 6 * 3600_000 }), {
  ttl: 6 * 3600_000,
});

const norm = (s = '') =>
  s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function globalTopTracks(limit = 12) {
  return cache.resolve(`global:${limit}`, async () => {
    const fetchLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
    const r = await safeFetch(`https://itunes.apple.com/us/rss/topsongs/limit=${fetchLimit}/json`, {
      timeout: 8000,
    });
    if (!r?.ok) return [];
    let entries = [];
    try {
      entries = (await r.json())?.feed?.entry || [];
    } catch {
      return [];
    }
    const meta = entries
      .map((e) => ({
        title: String(e['im:name']?.label || '').trim(),
        artist: String(e['im:artist']?.label || '').trim(),
      }))
      .filter((m) => m.title && m.artist)
      .slice(0, limit);

    const concurrency = 8;
    const resolved = new Array(meta.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < meta.length) {
        const idx = cursor++;
        const m = meta[idx];
        if (!m) continue;
        try {
          // raw path: one InnerTube call per track, parser-crash immune
          const { tracks } = await yt.rawSearchSongs(`${m.title} ${m.artist}`, 3);
          const exact = tracks.find((t) => norm(t.title).startsWith(norm(m.title).slice(0, 10)));
          resolved[idx] = exact || tracks[0] || null;
        } catch {
          resolved[idx] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, meta.length) }, worker));
    return resolved.filter(Boolean).slice(0, limit);
  });
}
