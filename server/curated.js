/**
 * curated.js — the home page's playlist rows, from YouTube Music's own mood & genre pages.
 *
 * Each row gathers the playlists of a few matching YouTube Music categories, keeps the ones
 * YouTube Music itself curates (credited to "YouTube Music") first, removes repeats and trims the
 * row. Nothing here is a user's playlist unless the category has too few official ones to fill a
 * row, and then the gap is filled in order of how the category ranks them.
 */

import { TTLCache, AsyncResolver, withTimeout } from './cache.js';
import * as yt from './yt.js';

const ROWS = [
  {
    id: 'desi',
    title: 'Bollywood & Hindi',
    detail: 'The film hits, the romance and the evergreens',
    match: [/^hindi$/i, /bollywood/i, /^indian pop$/i, /^punjabi$/i, /desi hip/i, /ghazal|sufi/i],
  },
  {
    id: 'global',
    title: 'Global Hits',
    detail: 'What the world is playing right now',
    match: [/^pop$/i, /^hip-hop$/i, /^dance & electronic$/i, /r&b/i, /^k-pop$/i, /^latin$/i],
  },
  {
    id: 'mood',
    title: 'Mood & Moments',
    detail: 'A sound for exactly how you feel',
    match: [/^feel good$/i, /^romance$/i, /^chill$/i, /^party$/i, /^energi[sz]e$/i, /^sad$/i],
  },
  {
    id: 'focus',
    title: 'Workout, Focus & Late Nights',
    detail: 'Built for the gym, the desk and the drive home',
    match: [/^workout$/i, /^focus$/i, /^commute$/i, /^sleep$/i, /^gaming$/i, /^travel$/i],
  },
];

const ROW_SIZE = 16;
const PER_ROW_CATEGORIES = 4;

const cache = new AsyncResolver(new TTLCache({ max: 4, ttl: 3 * 3600_000 }), { ttl: 3 * 3600_000, negativeTtl: 60_000 });
const sectionCache = new AsyncResolver(new TTLCache({ max: 80, ttl: 6 * 3600_000 }), { ttl: 6 * 3600_000, negativeTtl: 60_000 });

const isOfficial = (card) => /youtube music/i.test(String(card.subtitle || ''));
const titleKey = (t = '') => String(t).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

async function buildRow(row, categories) {
  const picked = [];
  for (const pattern of row.match) {
    const hit = categories.find((c) => pattern.test(c.label.trim()) && !picked.includes(c));
    if (hit) picked.push(hit);
    if (picked.length >= PER_ROW_CATEGORIES) break;
  }
  if (!picked.length) return null;

  const lists = await Promise.all(
    picked.map((category) =>
      withTimeout(sectionCache.resolve(`cur:${category.params}`, () => yt.genrePlaylists(category.params)), 9000, null).catch(() => null),
    ),
  );

  // Round-robin across the categories so one genre does not take the whole row.
  const pools = lists.map((l) => (l?.items || []).filter((c) => c.kind === 'playlist' && c.thumb));
  const official = [];
  const rest = [];
  const seen = new Set();
  for (let i = 0; official.length + rest.length < ROW_SIZE * 4; i++) {
    let any = false;
    for (const pool of pools) {
      const card = pool[i];
      if (!card) continue;
      any = true;
      const key = card.id || titleKey(card.title);
      const tkey = `t:${titleKey(card.title)}:${titleKey(card.subtitle)}`;
      if (seen.has(key) || seen.has(tkey)) continue;
      seen.add(key);
      seen.add(tkey);
      (isOfficial(card) ? official : rest).push(card);
    }
    if (!any) break;
  }
  const items = [...official, ...rest].slice(0, ROW_SIZE);
  if (items.length < 4) return null;
  return { id: row.id, title: row.title, detail: row.detail, items };
}

export async function curatedHome() {
  return cache.resolve('curated', async () => {
    const categories = await withTimeout(yt.genreCategories(), 9000, null);
    if (!categories?.length) return null;
    const rows = (await Promise.all(ROWS.map((row) => buildRow(row, categories).catch(() => null)))).filter(Boolean);
    return rows.length ? { rows } : null;
  });
}
