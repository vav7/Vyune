/**
 * artistimages.js — extra HD pictures of an artist, for the artist page's slow
 * slideshow when Apple has no motion clip for them.
 *
 * Sources, best first: Deezer's artist portrait (1000px, no key), the
 * JioSaavn wrapper's artist image (500px+), all verified to be the artist whose
 * name matches. The YouTube Music banner is added by the client, which
 * already has it.
 */
import { AsyncResolver, TTLCache, safeFetch, UA } from './cache.js';

const cache = new AsyncResolver(new TTLCache({ max: 400, ttl: 12 * 3600_000 }), { ttl: 12 * 3600_000 });

const norm = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function json(url, timeout = 5000) {
  const res = await safeFetch(url, { timeout, headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res?.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function deezer(name) {
  const j = await json(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const hit = (j?.data || []).find((a) => norm(a.name) === norm(name));
  if (!hit) return [];
  // Deezer answers a grey silhouette (an empty md5 in the URL path) when it has no photo.
  const url = hit.picture_xl || hit.picture_big;
  if (!url || /\/artist\/(?:\/|$)/.test(url)) return [];
  return [url];
}

async function saavnArtist(name) {
  const params = new URLSearchParams({
    __call: 'search.getArtistResults',
    _format: 'json',
    _marker: '0',
    api_version: '4',
    ctx: 'web6dot0',
    p: '1',
    n: '5',
    q: name,
  });
  const j = await json(`https://www.jiosaavn.com/api.php?${params}`);
  const rows = j?.results || [];
  const hit = rows.find((a) => norm(a.name) === norm(name));
  const img = hit?.image;
  return img ? [img.replace(/-(50x50|150x150)(\.\w+)?$/, '-500x500.jpg')] : [];
}

/** @returns {Promise<string[]>} distinct HD portraits (may be empty) */
export function artistImages(name) {
  const key = norm(name);
  if (!key) return Promise.resolve([]);
  return cache.resolve(`ai:${key}`, async () => {
    const [d, s] = await Promise.all([deezer(name).catch(() => []), saavnArtist(name).catch(() => [])]);
    return [...new Set([...d, ...s])];
  });
}
