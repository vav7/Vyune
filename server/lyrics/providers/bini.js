/**
 * BiniLyrics — the same Apple timings, matched on the recording itself.
 *
 * The only provider that answers to a recording rather than a name, and the one whose search
 * REPORTS the ISRC of what it matched. That is the arrangement: ask by name once, and every
 * other provider can ask by recording. `identify` is that one small search; the engine runs it
 * before anybody else is asked for words and shares the answer.
 */

import { cleanIsrc } from '../text.js';
import { parseTTML } from '../parse/ttml.js';
import { isThisSong } from '../verify.js';

const BASE = 'https://lyrics-api.binimum.org/';

/** Which recording is this, without fetching its words. A miss is a 404 here, which io turns into null. */
export async function identify(ctx, io) {
  const isrc = cleanIsrc(ctx.isrc);
  // With a recording named, nothing else is worth sending: a title could only ever disagree with it.
  const attempts = isrc
    ? [new URLSearchParams({ isrc })]
    : [
        // duration is a hint, not a filter — ask again without it on a miss
        ...(ctx.duration ? [paramsFor(ctx, true)] : []),
        paramsFor(ctx, false),
      ];
  for (const params of attempts) {
    const data = await io.json(`${BASE}?${params}`, { timeout: 6000 });
    const hits = Array.isArray(data?.results) ? data.results : [];
    const hit = isrc
      ? hits.find((h) => h?.lyricsUrl)
      : hits.find((h) => h?.lyricsUrl && isThisSong({ title: h.track_name || '', artist: h.artist_name || '', durationSec: h.duration || null, album: h.album_name || null }, ctx));
    if (hit) return hit;
  }
  return null;
}

function paramsFor({ title, artist, album, duration }, withDuration) {
  const p = new URLSearchParams({ track: title, artist });
  if (album) p.set('album', album);
  if (withDuration && duration) p.set('duration', String(Math.round(duration)));
  return p;
}

/** The document a hit points at, fetched (shared with lrc.red when it is the same file) and parsed. */
export async function sheetFromHit(hit, io) {
  if (!hit?.lyricsUrl) return null;
  const ttml = await io.text(hit.lyricsUrl, { timeout: 6000 });
  const parsed = ttml ? parseTTML(ttml) : null;
  if (!parsed?.lines?.length) return null;
  return { lines: parsed.lines, songwriters: parsed.songwriters, isrc: cleanIsrc(hit.isrc) };
}

export default {
  id: 'bini',
  label: 'BiniLyrics',
  needsRecording: true,
  async run(ctx, io, env) {
    const hit = env?.recording?.hit ?? (await identify(ctx, io));
    return sheetFromHit(hit, io);
  },
};
