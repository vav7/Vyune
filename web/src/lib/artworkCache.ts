/**
 * artworkCache.ts — High-performance client-side artwork caching & preloading.
 *
 * 1. Memory Cache: Instant synchronous lookup (<0.1ms) across UI rerenders.
 * 2. Persistent Storage Cache: Retains verified studio album art across browser sessions.
 * 3. Browser Cache API / Image Pre-decoding: Warms the browser's image decode cache so
 *    artwork paints on frame 1 with zero flashes or layout shifts.
 */

import type { Track } from './types';
import { api } from './api';

const MEM_CACHE = new Map<string, string>();
const STORAGE_KEY = 'vyune_art_cache_v2';
const MAX_STORAGE_ENTRIES = 400;

function cacheKey(t: Pick<Track, 'id' | 'title' | 'artists' | 'album'>): string {
  const title = (t.title || '').trim().toLowerCase();
  const artist = (t.artists || []).join(', ').trim().toLowerCase();
  return `${t.id || ''}:${title}:${artist}`;
}

// Hydrate from localStorage once at startup
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') MEM_CACHE.set(k, v);
      }
    }
  }
} catch {}

function persistStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const entries = [...MEM_CACHE.entries()].slice(-MAX_STORAGE_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

/** Check synchronous memory cache for verified studio artwork */
export function getCachedArtwork(track: Pick<Track, 'id' | 'title' | 'artists' | 'album'>): string | null {
  const key = cacheKey(track);
  return MEM_CACHE.get(key) || null;
}

/** Preload image into browser memory cache for zero-latency frame-1 paints */
export function preloadImage(url: string): void {
  if (!url || typeof window === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = url;

  // Cache in CacheStorage if supported
  if ('caches' in window) {
    void window.caches.open('vyune-art-v1').then((cache) => {
      cache.match(url).then((matched) => {
        if (!matched) {
          fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res)).catch(() => {});
        }
      });
    }).catch(() => {});
  }
}

/** Save verified high-res studio artwork into client cache and pre-decode */
export function setCachedArtwork(track: Pick<Track, 'id' | 'title' | 'artists' | 'album'>, url: string): void {
  if (!url) return;
  const key = cacheKey(track);
  MEM_CACHE.set(key, url);
  preloadImage(url);
  persistStorage();
}

/** Asynchronously resolve and pre-warm high-res studio artwork for a track */
export async function warmTrackArtwork(track: Track, signal?: AbortSignal): Promise<string | null> {
  const cached = getCachedArtwork(track);
  if (cached) return cached;

  try {
    const res = await api.artwork(track, signal);
    if (res?.thumb && !/(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(res.thumb)) {
      setCachedArtwork(track, res.thumb);
      return res.thumb;
    }
  } catch {}

  return null;
}
