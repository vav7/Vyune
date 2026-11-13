/* textsim.js — plain text-similarity helpers (normalisation, token overlap, edit distance).
 * Used by the stream/identity matchers. Search results are NOT scored or re-ordered with these:
 * the search tab shows YouTube Music's own order. */

/** Remove bracketed extras and punctuation for matching.
 *  Combining marks (\p{M}) are KEPT: they are the Devanagari vowel signs, and
 *  dropping them turns "तुम हिआ हो" into "तम ह हो" — a different word. */
export function normText(s = '') {
  return s
    .toLowerCase()
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, ' ') // drop (feat..)/(remaster..) brackets
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\b(feat|ft|featuring|with|from|official|audio|video|music|lyrics|lyric|hd|hq|mv|ls|version|remaster|remastered|mono|stereo)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(normText(s).split(' ').filter((t) => t.length > 1));
}



/** Token overlap (order-insensitive, tolerant to typos via prefix match). */
export function tokenSim(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const x of ta) {
    for (const y of tb) {
      if (x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x) || (x.length > 4 && y.length > 4 && x.startsWith(y.slice(0, 4)) && y.startsWith(x.slice(0, 4)))))) {
        hit++;
        break;
      }
    }
  }
  return hit / Math.max(ta.size, tb.size);
}

/** Bounded Damerau-Levenshtein ratio on strings <= 64 chars. */
export function levRatio(a, b) {
  a = normText(a).slice(0, 64);
  b = normText(b).slice(0, 64);
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const maxD = Math.ceil(Math.max(m, n) * 0.6); // early-exit bound
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxD) return 0; // too different — bail out fast
    prev2 = prev;
    prev = cur;
  }
  return Math.max(0, 1 - prev[n] / Math.max(m, n));
}
