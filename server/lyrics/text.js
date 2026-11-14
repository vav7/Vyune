/**
 * text.js — names, as lyric databases catalogued them.
 *
 * The title a player has is YouTube's, and nobody filed the song under it:
 * "Dracula (feat. JENNIE)" is "Dracula" everywhere else. So titles are cleaned
 * before they are asked for — but only of CREDITS and PACKAGING.
 *
 * Anything that names a different recording stays on ("Remix", "Acoustic",
 * "Live", "Sped Up", "Instrumental"…). Stripping those turns a search for one
 * recording into a search for another, and the wrong words scrolling in time
 * with the right song is worse than no words. A film credit — "(From "Aashiqui 2")" — and a remaster
 * stamp are not different recordings, so those do come off.
 */

/** Lower case, letters/digits/marks only. Combining marks stay: they are the Devanagari vowel signs. */
export const normKey = (s = '') => String(s).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

/** Words of a title/credit, for overlap tests. One-letter Latin words are noise; one-letter Indic words are not. */
export const normWords = (s = '') =>
  normKey(s)
    .split(' ')
    .filter((w) => w.length > 2 || (w.length > 0 && !/[a-z0-9]/.test(w)));

export const simWords = (a, b) => {
  if (!a.length || !b.length) return 0;
  return a.filter((w) => b.includes(w)).length / Math.max(a.length, b.length);
};

const CREDITS = [
  // Bracketed credits: (feat. X), [ft. X], (with X)
  /\s*[(\[]\s*(?:feat|ft|featuring|with)\b[^)\]]*[)\]]/gi,
  // The same, unbracketed and running to the end of the title
  /\s+(?:feat|ft|featuring)\.?\s+.*$/gi,
  // How the upload was labelled, not what was recorded
  /\s*[(\[]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|visuali[sz]er|lyrics?\s*video|lyrics?|m\/?v|hd|hq|4k|full\s*song)\s*[)\]]/gi,
  /\s*[(\[]\s*official\s*[)\]]/gi,
  // Film / album credit and remaster stamps: same recording, different label
  /\s*[(\[]\s*(?:from|remaster\w*|\d{4}\s*remaster\w*)\b[^)\]]*[)\]]/gi,
  // Trailing " - Official Video" style decoration
  /\s*[-|–]\s*(?:official\s*)?(?:lyrics?|audio|video|music video|lyric video|hd|hq)\s*$/gi,
];

export function cleanTitle(title = '', artist = '') {
  let name = String(title || '');
  for (const pattern of CREDITS) name = name.replace(pattern, ' ');
  name = name.replace(/\s+/g, ' ').trim().replace(/[,\-–—]+$/, '').trim();

  // If title begins with "Artist - " or "Artist – ", strip it to isolate pure song name
  if (artist) {
    const artKey = normKey(artist);
    const m = name.match(/^([^–—\-:|]+)\s*[-–—:|]\s*(.+)$/);
    if (m) {
      const prefixKey = normKey(m[1]);
      if (prefixKey && (prefixKey === artKey || artKey.includes(prefixKey) || prefixKey.includes(artKey))) {
        name = m[2].trim();
      }
    }
  } else {
    // If no artist given, strip leading "Artist - " if suffix is not a take modifier
    const m = name.match(/^([^–—\-:|]+)\s*[-–—:|]\s*(.+)$/);
    if (m && !/^(live|remix|acoustic|instrumental|version|edit|mix|sped|slowed|lofi)\b/i.test(m[2])) {
      name = m[2].trim();
    }
  }

  return name || String(title).trim(); // a title that was only packaging is better asked as given than as nothing
}

/** " - Topic" and "VEVO" are channel names, not artists. */
export const cleanArtist = (artist = '') =>
  String(artist).replace(/\s*[-–|]\s*topic\s*$/i, '').replace(/\s*vevo\s*$/i, '').trim();

/** Full credit + each name in it, the one the query mentions first. */
export function artistVariants(artist = '', hint = '', max = 3) {
  const full = String(artist).trim();
  const parts = full.split(/,|&/).map((x) => x.trim()).filter(Boolean);
  const hintWords = normKey(hint).split(' ').filter((w) => w.length > 2);
  const score = (v) => {
    const words = normKey(v).split(' ');
    return hintWords.filter((w) => words.some((x) => x.includes(w) || w.includes(x))).length;
  };
  const segments = [...new Set(parts)].sort((a, b) => score(b) - score(a));
  return [...new Set([segments[0], full, ...segments.slice(1)])].filter(Boolean).slice(0, max);
}

/** `CC-XXX-YY-NNNNN`, dashes removed. Nothing else is ever put into a URL path. */
export const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const cleanIsrc = (value) => {
  const code = String(value || '').replace(/-/g, '').trim().toUpperCase();
  return ISRC.test(code) ? code : null;
};

/** Words that make a bracket a different recording rather than a different label. */
export const VERSION_WORDS = new Set([
  'live', 'remix', 'remixed', 'mix', 'acoustic', 'unplugged', 'instrumental', 'karaoke', 'cappella', 'acapella',
  'demo', 'edit', 'version', 'cover', 'sped', 'slowed', 'reverb', 'nightcore', 'lofi', 'orchestral', 'extended',
]);
