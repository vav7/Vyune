/**
 * providers/index.js — every timed provider, in priority order.
 *
 * The order is the tie-break when two sheets score alike and decides who is waited for: a source
 * ranked higher is given a short grace to overtake a sheet already in hand. Only direct, keyless,
 * TIMED sources are here; aggregator mirrors and key-gated endpoints were removed because they were
 * the flaky half of the old chain.
 */

import amll from './amll.js';
import lrcred from './lrcred.js';
import bini from './bini.js';
import netease from './netease.js';
import kugou from './kugou.js';
import unison from './unison.js';
import lrclib from './lrclib.js';
import yt from './yt.js';
import * as betterlyrics from './betterlyrics.js';

export const PROVIDERS = [
  amll,
  lrcred,
  bini,
  netease,
  kugou,
  lrclib,
  betterlyrics.ttml,
  betterlyrics.qq,
  yt,
  unison,
  betterlyrics.kugou,
];

/** Find a provider by id, label, or the lowercased label the client sends back. */
export function providerFor(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9.]+/g, '');
  return PROVIDERS.find((p) => p.id.replace(/[^a-z0-9.]+/g, '') === key || p.label.toLowerCase().replace(/[^a-z0-9.]+/g, '') === key) || null;
}
