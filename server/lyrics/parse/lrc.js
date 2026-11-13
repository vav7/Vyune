/**
 * parse/lrc.js — LRC in all its shapes → lyric lines.
 *
 *   [mm:ss.xx] words                         line-synced
 *   [mm:ss.xx] <mm:ss.xx>word <mm:ss.xx>word  enhanced ("A2"), word-synced
 *   words, one per line                       plain (no timing)
 *
 * A line may carry several stamps ("[00:10.00][01:20.00]chorus"): it is sung at each.
 */

import { lineSynced, makeLine, syl } from '../model.js';

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;

/** mm, ss and a 2- or 3-digit fraction → milliseconds. */
function stampMs(mm, ss, frac) {
  let ms = 0;
  if (frac != null) ms = frac.length >= 3 ? Number(frac.slice(0, 3)) : Number(frac) * (frac.length === 1 ? 100 : 10);
  return (Number(mm) * 60 + Number(ss)) * 1000 + ms;
}

/** "[ar:…]" "[ti:…]" "[offset:…]" — tags, not lyrics. */
const isTag = (line) => /^\[[a-z#]+:/i.test(line);

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function parseLrc(text) {
  if (!text || typeof text !== 'string') return [];
  const rows = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || isTag(line)) continue;
    const stamps = [...line.matchAll(STAMP)];
    if (!stamps.length) continue;
    const body = line.slice(stamps[stamps.length - 1].index + stamps[stamps.length - 1][0].length).replace(/^\s/, '');
    for (const s of stamps) rows.push({ at: stampMs(s[1], s[2], s[3]), body });
  }
  rows.sort((a, b) => a.at - b.at);

  const lines = [];
  rows.forEach((row, i) => {
    if (!row.body.trim()) return;
    const end = rows[i + 1] ? Math.max(rows[i + 1].at, row.at) : row.at + 5000;
    const words = [...row.body.matchAll(WORD)];
    if (words.length >= 2) {
      // Some writers leave no spaces at all: then every stamp is a whole word, not a syllable.
      const spaced = words.some((w) => /\s$/.test(w[4] || ''));
      const parts = [];
      words.forEach((w, k) => {
        const start = stampMs(w[1], w[2], w[3]);
        const next = words[k + 1];
        const stop = next ? stampMs(next[1], next[2], next[3]) : end;
        let spoken = decode(w[4] || '');
        if (!spaced && k < words.length - 1 && spoken.trim()) spoken += ' ';
        if (spoken.trim()) parts.push(syl(spoken, start, Math.max(start, stop), { part: !/\s$/.test(spoken) }));
      });
      if (parts.length >= 2) {
        // A run with no trailing space is a syllable of a word that carries on.
        const last = parts[parts.length - 1];
        last.part = false;
        lines.push(makeLine({ text: parts, timestamp: parts[0].timestamp, endtime: last.endtime, isWordSynced: true }));
        return;
      }
    }
    lines.push(lineSynced(decode(row.body.replace(WORD, '$4').trim()), row.at, end));
  });
  return lines;
}

/* ---------------------------- plain words ---------------------------- */

/** A heading only when it says something structural: "(Chorus)" is one, "(oh)" is a lyric. */
const SECTION_WORD = /verse|chorus|intro|outro|bridge|hook|refrain|interlude|instrumental|breakdown|pre|post|part|rap|solo|repeat/i;
const SECTION_LINE = /^\s*[\[(]\s*([^)\]]{1,32})\s*[\])]\s*$/;

/** Plain text → unsynced lines. Section headings are kept and flagged: they are all the structure a plain sheet has. */
export function parsePlain(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = SECTION_LINE.exec(line)?.[1]?.trim();
    if (heading && SECTION_WORD.test(heading)) {
      out.push(makeLine({ text: [syl(heading, 0, 0)], section: true }));
      continue;
    }
    if (/^\[[a-z#]/i.test(line)) continue; // "[ar:…]", "[00:12]"
    out.push(makeLine({ text: [syl(line, 0, 0)] }));
  }
  return out;
}

/** Whatever this is: word-stamped, line-stamped or plain. */
export function parseAnyLrc(text) {
  const timed = parseLrc(text);
  return timed.length ? timed : parsePlain(text);
}
