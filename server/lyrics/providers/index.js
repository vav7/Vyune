/**
 * providers/index.js — every timed provider, in priority order.
 *
 * The order is the tie-break when two sheets score alike and decides who is waited for: a source
 * ranked higher is given a short grace to overtake a sheet already in hand. Only direct, keyless,
 * TIMED sources are here.
 */

import lyricsplus from './lyricsplus.js';
import lrcred from './lrcred.js';
import * as betterlyrics from './betterlyrics.js';
import simpmusic from './simpmusic.js';
import lrclib from './lrclib.js';
import unison from './unison.js';
import amll from './amll.js';
import bini from './bini.js';
import netease from './netease.js';
import kugou from './kugou.js';
import yt from './yt.js';

export const PROVIDERS = [
  lyricsplus,
  lrcred,
  betterlyrics.ttml,
  betterlyrics.qq,
  simpmusic,
  lrclib,
  unison,
  amll,
  bini,
  netease,
  kugou,
  yt,
  betterlyrics.kugou,
];

const ALIASES = {
  lyricsplus: 'lyricsplus',
  'lyrics plus': 'lyricsplus',
  lrcred: 'lrc.red',
  'lrc.red': 'lrc.red',
  betterlyrics: 'betterlyrics-ttml',
  'better lyrics': 'betterlyrics-ttml',
  'betterlyrics qq': 'betterlyrics-qq',
  'better lyrics qq': 'betterlyrics-qq',
  'betterlyrics-qq': 'betterlyrics-qq',
  'betterlyrics-ttml': 'betterlyrics-ttml',
  'betterlyrics kugou': 'betterlyrics-kugou',
  'better lyrics kugou': 'betterlyrics-kugou',
  'betterlyrics-kugou': 'betterlyrics-kugou',
  simpmusic: 'simpmusic',
  'simp music': 'simpmusic',
  lrclib: 'lrclib',
  'lrc lib': 'lrclib',
  unison: 'unison',
  amll: 'amll',
  bini: 'bini',
  binilyrics: 'bini',
  'bini lyrics': 'bini',
  netease: 'netease',
  kugou: 'kugou',
  yt: 'yt',
  'youtube music': 'yt',
  youtubemusic: 'yt',
};

/** Find a provider by id, label, or the lowercased label the client sends back. */
export function providerFor(name) {
  const raw = String(name || '').trim().toLowerCase();
  const directId = ALIASES[raw] || ALIASES[raw.replace(/[^a-z0-9]+/g, ' ')];
  if (directId) {
    const found = PROVIDERS.find((p) => p.id === directId);
    if (found) return found;
  }
  const key = raw.replace(/[^a-z0-9.]+/g, '');
  return (
    PROVIDERS.find(
      (p) =>
        p.id.replace(/[^a-z0-9.]+/g, '') === key ||
        p.label.toLowerCase().replace(/[^a-z0-9.]+/g, '') === key ||
        p.id.toLowerCase().includes(key) ||
        p.label.toLowerCase().includes(key),
    ) || null
  );
}
