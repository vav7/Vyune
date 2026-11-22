/**
 * Better Lyrics — the backend of the YouTube Music browser extension of the same name.
 *
 * One key-less call keyed on title, artist, album and duration. Three routes:
 *   TTML     Apple Music timings, per syllable (the extension's original host)
 *   QQ       QQ Music karaoke timings ("Portato")
 *   KuGou    whole lines
 */

import { parsePayload } from '../parse/envelope.js';
import { parseLrc } from '../parse/lrc.js';
import { simWords, normWords, cleanTitle, cleanArtist } from '../text.js';
import { isThisSong } from '../verify.js';

const HOSTS = ['https://api.betterlyrics.org', 'https://lyrics-api.boidu.dev'];

function query({ title, artist, album, duration }) {
  const p = new URLSearchParams({ s: title, a: artist });
  if (duration) p.set('d', String(Math.round(duration)));
  if (album) p.set('al', album);
  return p;
}

async function ask(route, hosts, ctx, io) {
  if (!ctx.title || !ctx.artist) return null;
  const queries = [
    { title: cleanTitle(ctx.title), artist: cleanArtist(ctx.artist), album: ctx.album, duration: ctx.duration },
    { title: ctx.title, artist: ctx.artist, album: ctx.album, duration: ctx.duration },
  ];
  for (const q of queries) {
    if (!q.title || !q.artist) continue;
    for (const host of hosts) {
      const body = await io.text(`${host}${route}?${query(q)}`, { timeout: 3500 }).catch(() => null);
      if (body) return body;
    }
  }
  return null;
}

export const ttml = {
  id: 'betterlyrics-ttml',
  label: 'Better Lyrics',
  async run(ctx, io) {
    const body = await ask('/getLyrics', HOSTS, ctx, io);
    const parsed = body ? parsePayload(body) : null;
    if (!parsed?.lines?.length) return null;
    if (parsed.title && !isThisSong({ title: parsed.title, artist: parsed.artist || '', durationSec: ctx.duration || null, album: parsed.album || null }, ctx)) {
      return null;
    }
    return parsed.lines.some((l) => l.isWordSynced) ? { lines: parsed.lines, songwriters: parsed.songwriters } : null;
  },
};

export const qq = {
  id: 'betterlyrics-qq',
  label: 'Better Lyrics QQ',
  async run(ctx, io) {
    const body = await ask('/qq/getLyrics', HOSTS, ctx, io);
    const parsed = body ? parsePayload(body) : null;
    if (!parsed?.lines?.length) return null;
    // QQ says which song it thinks this is.
    if (parsed.title && !isThisSong({ title: parsed.title, artist: parsed.artist || '', durationSec: ctx.duration || null, album: parsed.album || null }, ctx)) {
      return null;
    }
    // A sheet that repeats the title as a timed row has not had its header stripped.
    const lines = parsed.lines.filter((l) => !(parsed.title && simWords(normWords(l.text.map((p) => p.text).join('')), normWords(parsed.title)) >= 0.8 && l.text.length < 8));
    return lines.length ? { lines } : null;
  },
};

export const kugou = {
  id: 'betterlyrics-kugou',
  label: 'Better Lyrics KuGou',
  async run(ctx, io) {
    const body = await ask('/kugou/getLyrics', HOSTS, ctx, io);
    const parsed = body ? parsePayload(body) : null;
    if (parsed?.title && !isThisSong({ title: parsed.title, artist: parsed.artist || '', durationSec: ctx.duration || null, album: parsed.album || null }, ctx)) {
      return null;
    }
    const lines = parsed?.lines?.some((l) => l.timestamp > 0) ? parsed.lines : parseLrc(body || '');
    return lines.length ? { lines } : null;
  },
};
