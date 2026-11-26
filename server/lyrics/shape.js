/**
 * shape.js — the last pass before a sheet leaves the server.
 *
 * Whichever provider won, its lines are made fit for the screen:
 *   1. long rows are cut at word boundaries, timing kept (full-screen shows many lines, not one paragraph);
 *   2. timed background vocals read as adlibs: "(ooh, yeah)";
 *   3. Indic marks stay attached to their letters, so no matra floats away from its akshara.
 */

import { hasLineSync, hasWordSync, rowText, syl } from './model.js';

/* ---------------------------- phonetic syllable flow alignment ---------------------------- */

const LATIN_VOWEL = /[aeiouy]/gi;
const INDIC_VOWEL_OR_MATRA = /[\u0904-\u0914\u093e-\u094c\u0960-\u0963]/g;
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g;

function getWordWeight(word) {
  const clean = word.trim();
  if (!clean) return 0.5;

  const cjkCount = (clean.match(CJK_CHAR) || []).length;
  if (cjkCount > 0) return cjkCount * 1.0;

  const indicVowels = (clean.match(INDIC_VOWEL_OR_MATRA) || []).length;
  if (indicVowels > 0) {
    return Math.max(0.8, indicVowels * 0.9 + (clean.length - indicVowels) * 0.2);
  }

  const vowelGroups = clean.match(/[aeiouy]+/gi) || [];
  let weight = 0;
  for (const vg of vowelGroups) {
    weight += vg.length > 1 ? 1.3 : 1.0;
  }
  if (/[,…—~]$/.test(clean)) weight += 0.4;

  return Math.max(0.7, weight + (clean.length - (clean.match(LATIN_VOWEL) || []).length) * 0.15);
}

export function alignLineWords(line, nextLineStart = null) {
  // If line already has multiple timed words, keep native timings intact
  if (line.isWordSynced && Array.isArray(line.text) && line.text.length > 1) {
    return line;
  }

  const lineText = (line.text?.[0]?.text || '').trim();
  if (!lineText || line.section) return line;

  const tStart = line.timestamp || 0;
  let tEnd = line.endtime || 0;

  if (tEnd <= tStart) {
    if (nextLineStart && nextLineStart > tStart) {
      tEnd = Math.min(nextLineStart - 150, tStart + 6000);
    } else {
      tEnd = tStart + Math.max(1800, lineText.length * 90);
    }
  }

  const duration = Math.max(500, tEnd - tStart);
  const rawWords = lineText.match(/\S+\s*/g) || [lineText];
  if (rawWords.length <= 1) {
    return {
      ...line,
      timestamp: tStart,
      endtime: tEnd,
      isWordSynced: true,
      text: [syl(lineText, tStart, tEnd, { part: false })],
    };
  }

  const weights = rawWords.map(getWordWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const leadIn = Math.min(60, Math.round(duration * 0.03));
  const release = Math.min(180, Math.round(duration * 0.06));
  const singingSpan = duration - leadIn - release;

  let at = tStart + leadIn;
  const wordParts = [];

  for (let i = 0; i < rawWords.length; i++) {
    const wText = rawWords[i];
    const wDuration = Math.round((singingSpan * weights[i]) / totalWeight);
    const wStart = at;
    const wEnd = i === rawWords.length - 1 ? tEnd - Math.round(release * 0.5) : wStart + wDuration;
    at = wEnd;

    wordParts.push(syl(wText, wStart, wEnd, { part: false }));
  }

  return {
    ...line,
    timestamp: tStart,
    endtime: tEnd,
    isWordSynced: true,
    text: wordParts,
  };
}

export function alignSheetWords(sheet) {
  if (!sheet?.lines?.length) return sheet;
  // If sheet already has native word sync throughout, don't touch
  if (hasWordSync(sheet)) return sheet;

  const lines = sheet.lines;
  const alignedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    const nextStart = nextLine && nextLine.timestamp > line.timestamp ? nextLine.timestamp : null;
    alignedLines.push(alignLineWords(line, nextStart));
  }

  return {
    ...sheet,
    lines: alignedLines,
    isWordSynced: true,
  };
}

/* ---------------------------- long rows ---------------------------- */

const MAX_ROW_CHARS = 46;
const HARD_ROW_CHARS = 64;
const isCjk = (t) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t);

function splitRow(line) {
  if (line.section || line.background || !Array.isArray(line.text) || !line.text.length) return [line];
  const full = rowText(line.text).trim();
  if (full.length <= MAX_ROW_CHARS) return [line];
  const cjk = isCjk(full);
  const soft = cjk ? 18 : MAX_ROW_CHARS - 12;
  const cap = cjk ? 26 : HARD_ROW_CHARS;
  const out = [];

  if (line.text.length > 1) {
    // word-synced: group the row's own timed words
    let group = [];
    let len = 0;
    const flush = () => {
      if (!group.length) return;
      out.push({ ...line, text: group, timestamp: group[0].timestamp, endtime: group[group.length - 1].endtime, backgroundText: [] });
      group = [];
      len = 0;
    };
    line.text.forEach((part, i) => {
      group.push(part);
      len += part.text.length;
      const next = line.text[i + 1];
      const boundary = cjk || /\s$/.test(part.text) || (next && /^\s/.test(next.text)) || !next || part.part === false;
      const punct = /[,.;:!?،。，！？、]\s*$/.test(part.text);
      if (boundary && ((len >= soft && punct) || len >= soft + 8 || len >= cap)) flush();
    });
    flush();
  } else {
    // line-synced: one string, the row's time spread over the pieces by length
    const text = line.text[0].text;
    const pieces = [];
    if (cjk) {
      for (let i = 0; i < text.length; i += 20) pieces.push(text.slice(i, i + 20));
    } else {
      let cur = '';
      for (const word of text.split(/(?<=\s)/)) {
        if (cur && (cur + word).length > soft && (/[,.;:!?]\s*$/.test(cur) || (cur + word).length > cap - 14)) {
          pieces.push(cur);
          cur = '';
        }
        cur += word;
      }
      if (cur) pieces.push(cur);
    }
    const t0 = line.timestamp ?? line.text[0].timestamp ?? 0;
    const t1 = line.endtime > t0 ? line.endtime : t0;
    let at = 0;
    for (const piece of pieces) {
      const a = Math.round(t0 + ((t1 - t0) * at) / text.length);
      at += piece.length;
      const b = Math.round(t0 + ((t1 - t0) * at) / text.length);
      out.push({ ...line, text: [{ ...line.text[0], text: piece.trim(), timestamp: a, endtime: b }], timestamp: a, endtime: b, backgroundText: [] });
    }
  }
  // The adlibs belong to the end of the sentence they answered.
  if (out.length > 1 && Array.isArray(line.backgroundText) && line.backgroundText.length) out[out.length - 1].backgroundText = line.backgroundText;
  return out.length ? out : [line];
}

/* ---------------------------- adlibs ---------------------------- */

function bracketAdlibs(line) {
  const bg = line?.backgroundText;
  if (!Array.isArray(bg) || !bg.length) return line;
  const first = bg.findIndex((x) => x.text?.trim());
  if (first < 0) return line;
  let last = first;
  bg.forEach((x, i) => { if (x.text?.trim()) last = i; });
  const next = bg.map((x, i) => {
    let text = x.text;
    if (i === first && !/^\s*[(\[]/.test(text)) text = `(${text.trimStart()}`;
    if (i === last && !/[)\]]\s*$/.test(text)) text = `${text.trimEnd()})`;
    return text === x.text ? x : { ...x, text };
  });
  return { ...line, backgroundText: next };
}

/* ---------------------------- grapheme integrity ---------------------------- */

/**
 * Some sources cut a sheet by akshara and put a vowel sign (matra), a virama or a nukta in a
 * span of its own; drawn as separate pieces they fall apart from their letter. Any part that
 * begins with a combining mark (or follows a virama / joiner) is folded into the one before it.
 */
const MARK_START = /^[\p{M}\u200c\u200d]/u;
const VIRAMA_END = /[\u094d\u09cd\u0a4d\u0acd\u0b4d\u0bcd\u0c4d\u0ccd\u0d4d\u200d]$/u;

export function joinMarks(parts) {
  if (!Array.isArray(parts) || parts.length < 2) return parts;
  const out = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    const text = typeof part?.text === 'string' ? part.text : '';
    if (prev && text && !/^\s/.test(text) && !/\s$/.test(prev.text || '') && (MARK_START.test(text) || VIRAMA_END.test(prev.text || ''))) {
      out[out.length - 1] = { ...prev, text: `${prev.text}${text}`, endtime: Math.max(prev.endtime ?? 0, part.endtime ?? 0) };
    } else {
      out.push(part);
    }
  }
  return out;
}

function wholeGraphemes(line) {
  if (!Array.isArray(line?.text)) return line;
  const text = joinMarks(line.text);
  const bg = Array.isArray(line.backgroundText) ? joinMarks(line.backgroundText) : line.backgroundText;
  return text === line.text && bg === line.backgroundText ? line : { ...line, text, backgroundText: bg };
}

/**
 * Re-space a line of Indic lyrics from its plain text.
 *
 * Word-sync providers segment by akshara, not by word: "तुम हिआ हो" arrives as ["तुम","हि"], ["आ","हो"],
 * with the space inside a word. The plain line still has the true spaces, so syllables are re-aligned to
 * its words. Used only when the two strings really are the same characters; otherwise the line is untouched.
 */
export function respaced(syllables, plainText) {
  if (!Array.isArray(syllables) || syllables.length < 2) return syllables;
  const words = String(plainText || '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return syllables;

  const chars = [];
  for (const s of syllables) for (const ch of String(s.text || '').replace(/\s+/g, '')) chars.push({ ch, syl: s });
  const plain = words.join('');
  if (!chars.length || chars.map((c) => c.ch).join('') !== plain) return syllables;

  const out = [];
  let k = 0;
  words.forEach((word, wi) => {
    const group = [];
    for (let j = 0; j < word.length; j++) {
      const slice = chars[k++];
      const last = group[group.length - 1];
      if (last && last.src === slice.syl) {
        last.text += slice.ch;
        last.endtime = Math.max(last.endtime || 0, slice.syl.endtime || 0);
      } else {
        group.push({ text: slice.ch, part: true, timestamp: slice.syl.timestamp, endtime: slice.syl.endtime, src: slice.syl });
      }
    }
    group[group.length - 1].part = false;
    group[group.length - 1].text += wi < words.length - 1 ? ' ' : '';
    out.push(...group);
  });
  for (const s of out) delete s.src;
  return out;
}

/* ---------------------------- the pass ---------------------------- */

/** The sheet as the client receives it. */
export function present(sheet) {
  // Keep line-synced sheets honest (no fake word-sync guessing); word-synced sheets keep their real timings.
  const lines = sheet.lines.flatMap(splitRow).map(bracketAdlibs).map(wholeGraphemes);
  return {
    source: sheet.source,
    estimated: !!sheet.estimated,
    lines,
    isWordSynced: hasWordSync({ lines }),
    isSynced: hasWordSync({ lines }) || hasLineSync({ lines }),
    songwriters: sheet.songwriters || null,
    isrc: sheet.isrc || null,
    meta: sheet.meta || null,
  };
}
