/**
 * The last resort, so a song is never "not available" while anyone has its words: LRCLIB's plain text,
 * then YouTube Music's lyrics tab, then lyrics.ovh — with each line given an ESTIMATED time spread over
 * the song by length. Labelled, ranked below every real timed sheet, cached only briefly, and used only
 * when no timed provider has the song.
 */

import * as yt from '../../yt.js';
import { rowText } from '../model.js';
import { parsePlain } from '../parse/lrc.js';
import { lookupLrclib } from './lrclib.js';

async function words(ctx, io) {
  const lr = await lookupLrclib(ctx, io).catch(() => null);
  if (lr && !lr.synced) return { lines: lr.lines, label: 'LRCLIB' };

  if (ctx.videoId) {
    const text = await yt.getYTMusicLyrics(ctx.videoId).catch(() => null);
    const lines = text ? parsePlain(text) : [];
    if (lines.length) return { lines, label: 'YouTube Music' };
  }
  if (ctx.title && ctx.artist) {
    const data = await io.json(`https://api.lyrics.ovh/v1/${encodeURIComponent(ctx.artist)}/${encodeURIComponent(ctx.title)}`, { timeout: 3500 });
    const lines = parsePlain(data?.lyrics || '');
    if (lines.length) return { lines, label: 'lyrics.ovh' };
  }
  return null;
}

/** Plain lines → timed lines, the song's length shared out by how long each line is. */
export function estimateTiming(lines, durationSec) {
  const sung = lines.filter((l) => !l.section);
  const total = Math.max(60, durationSec || 210) * 1000;
  const start = Math.min(20_000, total * 0.06);
  const span = total * 0.9 - start;
  const weights = sung.map((l) => rowText(l.text).length + 10);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let at = start;
  let k = 0;
  return lines.map((l) => {
    if (l.section) return l;
    const length = (span * weights[k++]) / sum;
    const timestamp = Math.round(at);
    const endtime = Math.round(at + length);
    at += length;
    return { ...l, timestamp, endtime, isWordSynced: false, text: [{ ...l.text[0], timestamp, endtime }] };
  });
}

export async function plainFallback(ctx, io) {
  const found = await words(ctx, io);
  if (!found) return null;
  return { lines: estimateTiming(found.lines, ctx.duration), source: `${found.label} · estimated`, estimated: true };
}
