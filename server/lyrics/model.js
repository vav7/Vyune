/**
 * model.js — what a lyric sheet is, and how good one is.
 *
 * A *sheet* is what a provider returns:
 *   { lines, source, songwriters?, isrc?, byModel?, estimated?, meta? }
 * A *line* follows @uimaxbai/am-lyrics (the renderer on the client):
 *   { text: Syllable[], background, backgroundText, oppositeTurn,
 *     timestamp, endtime, isWordSynced, section? }
 * A *syllable* is { text, part, timestamp, endtime }. `part: true` means the
 * next syllable continues the same word.
 *
 * Quality has three tiers and the tier always wins, whatever the provider:
 *   word-synced  >  line-synced  >  plain words with an estimated timing
 * Inside a tier a sheet that is timed throughout, carries timed adlibs and has
 * finer word timing scores higher; the provider's reputation settles the rest.
 */

export const syl = (text, timestamp, endtime, extra = {}) => ({ text, part: false, timestamp, endtime, ...extra });

export const makeLine = (over = {}) => ({
  text: [],
  background: false,
  backgroundText: [],
  oppositeTurn: false,
  timestamp: 0,
  endtime: 0,
  isWordSynced: false,
  ...over,
});

/** A line that is only a sung-in-one-go string with a time range. */
export const lineSynced = (text, timestamp, endtime) =>
  makeLine({ text: [syl(text, timestamp, endtime, { lineSynced: true })], timestamp, endtime });

export const rowText = (parts) => parts.map((p) => p.text).join('');

export const toMs = (seconds, fallback = 0) =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : fallback;

/* ---------------------------- tiers ---------------------------- */

/** True word timing: more than one timed part, and the parts do not all share one range. */
function lineHasWordTiming(line) {
  if (!line.isWordSynced || !Array.isArray(line.text) || line.text.length < 2) return false;
  const timed = line.text.filter(
    (p) => Number.isFinite(p.timestamp) && Number.isFinite(p.endtime) && p.endtime > p.timestamp,
  );
  return timed.length > 1 && new Set(timed.map((p) => `${p.timestamp}|${p.endtime}`)).size > 1;
}

export const hasWordSync = (sheet) => sheet.lines.some(lineHasWordTiming);
export const hasLineSync = (sheet) => sheet.lines.some((l) => l.timestamp > 0 || l.endtime > 0);

export function tierOf(sheet) {
  if (sheet.estimated) return 'estimated';
  if (hasWordSync(sheet)) return 'word';
  if (hasLineSync(sheet)) return 'line';
  return 'plain';
}

/** Share of the sheet that is timed at all: 0 = all plain, 1 = all timed. */
function density(sheet) {
  if (!sheet.lines.length) return 0;
  const timed = sheet.lines.filter((l) => l.timestamp > 0 || l.endtime > l.timestamp || lineHasWordTiming(l));
  return timed.length / sheet.lines.length;
}

const adlibCount = (sheet) =>
  sheet.lines.filter((l) => Array.isArray(l.backgroundText) && l.backgroundText.some((x) => x.text?.trim())).length;

/* ---------------------------- score ---------------------------- */

/** Provider reputation: how honest and well-formed its sheets usually are. Breaks ties only. */
export const REPUTATION = {
  amll: 50,
  'lrc.red': 40,
  bini: 36,
  netease: 32,
  kugou: 30,
  lrclib: 28,
  yt: 26,
  'betterlyrics-ttml': 22,
  'betterlyrics-qq': 20,
  unison: 10,
  'betterlyrics-kugou': 4,
};

/** Providers are identified by a lowercase id; sheets carry a human label. This is the id. */
export const providerId = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

export function sheetScore(sheet) {
  if (sheet.estimated) return 100;
  const word = hasWordSync(sheet);
  let score = word ? 1000 : hasLineSync(sheet) ? 500 : 0;
  const d = density(sheet);
  score += d * 120 - (d < 0.5 ? 150 : 0);
  const adlibs = adlibCount(sheet);
  if (adlibs) score += Math.min(80, 20 + adlibs * 2);
  if (word) {
    const timed = sheet.lines.filter((l) => l.isWordSynced && Array.isArray(l.text));
    const avg = timed.length ? timed.reduce((n, l) => n + l.text.length, 0) / timed.length : 0;
    score += Math.min(30, avg * 3); // finer timing = more parts per line
  }
  score += REPUTATION[sheet.providerId || providerId(sheet.source)] ?? 0;
  if (sheet.byModel) score -= 60; // machine-made timing is a step down inside its tier, not out of it
  return score;
}
