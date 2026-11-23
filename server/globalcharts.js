/**
 * globalcharts.js — true worldwide global top tracks.
 *
 * Resolves the genuine Global Billboard Top 100 & Worldwide Top Hits
 * so home showcases authentic worldwide mainstream chart-toppers
 * (Bruno Mars, Lady Gaga, Billie Eilish, Taylor Swift, etc.) rather
 * than regional US country / rural charts.
 */

import { TTLCache, AsyncResolver } from './cache.js';
import * as yt from './yt.js';

const cache = new AsyncResolver(new TTLCache({ max: 8, ttl: 4 * 3600_000 }), {
  ttl: 4 * 3600_000,
});

// Official Global Chart Playlists on YouTube Music (Billboard Top 100 Global, Today's Top Hits)
export const GLOBAL_PLAYLISTS = [
  { id: 'PLDIoUOhQQPlWc-Kd6TCjTRIl0Z6fSQV0X', title: 'Billboard Hot 100 Global', subtitle: 'Official Worldwide Chart' },
  { id: 'PLO7-VO1D0_6MlO4UxJWFBUq3U-7zoIBf7', title: "Today's Top Hits Worldwide", subtitle: 'Global Mainstream Hits' },
  { id: 'PL4fGSIFgk540-3T1bI_6gBsm4zC-rC_60', title: 'Global Top Music Videos', subtitle: 'Official Top MVs' },
];

export function globalTopTracks(limit = 20) {
  return cache.resolve(`global:${limit}`, async () => {
    for (const plObj of GLOBAL_PLAYLISTS) {
      try {
        const pl = await yt.getPlaylist(plObj.id, { pages: 1 });
        if (pl?.tracks?.length) {
          const valid = pl.tracks
            .filter((t) => t?.id && t?.title && t?.thumb)
            .slice(0, limit);
          if (valid.length >= 10) return valid;
        }
      } catch {}
    }
    return [];
  });
}

export function globalChartPlaylists() {
  return GLOBAL_PLAYLISTS.map((p) => ({
    kind: 'playlist',
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    thumb: `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg`,
  }));
}
