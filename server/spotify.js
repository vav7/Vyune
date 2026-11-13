/**
 * Spotify as a metadata source: the canonical title, artists, album, artwork
 * and — most useful — the ISRC, the recording's own id, which matches the same
 * song across catalogues where names differ.
 *
 * Uses the free client-credentials flow; set SPOTIFY_CLIENT_ID and
 * SPOTIFY_CLIENT_SECRET (from developer.spotify.com). Without them every call
 * returns null at once. Spotify's API gives metadata and artwork only — never audio.
 */
import { AsyncResolver, TTLCache } from './cache.js';

let token = { value: null, until: 0 };
const cache = new AsyncResolver(new TTLCache({ max: 512, ttl: 24 * 3600_000 }), { ttl: 24 * 3600_000, negativeTtl: 600_000 });

export const spotifyEnabled = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

async function accessToken() {
  if (!spotifyEnabled()) return null;
  if (token.value && token.until > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(4000),
  });
  if (!resp.ok) return null;
  const body = await resp.json();
  token = { value: body.access_token, until: Date.now() + (body.expires_in || 3600) * 1000 };
  return token.value;
}

async function api(path) {
  const bearer = await accessToken();
  if (!bearer) return null;
  const resp = await fetch(`https://api.spotify.com/v1${path}`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(5000) });
  return resp.ok ? resp.json() : null;
}

const shape = (t) => ({
  spotifyId: t.id,
  isrc: t.external_ids?.isrc || null,
  title: t.name,
  artists: (t.artists || []).map((a) => a.name),
  artistIds: (t.artists || []).map((a) => a.id),
  album: t.album?.name || null,
  albumId: t.album?.id || null,
  thumb: t.album?.images?.[0]?.url || null,
  durationSec: Math.round((t.duration_ms || 0) / 1000) || null,
});

export function spotifyTrack(title, artist) {
  if (!spotifyEnabled() || !title) return Promise.resolve(null);
  return cache.resolve(`t:${title}|${artist}`.toLowerCase(), async () => {
    const q = encodeURIComponent(`track:${title} artist:${artist || ''}`.trim());
    const body = await api(`/search?type=track&limit=3&q=${q}`);
    const hit = body?.tracks?.items?.[0];
    return hit ? shape(hit) : null;
  });
}
