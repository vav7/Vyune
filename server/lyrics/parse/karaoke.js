/**
 * parse/karaoke.js — the word-timed formats of the Chinese catalogues.
 *
 *   KRC (KuGou)    [start,dur]<offset,dur,0>word<offset,dur,0>word   offsets relative to the line
 *   YRC (NetEase)  [start,dur](start,dur,0)word(start,dur,0)word     absolute times
 *   QRC (QQ)       [start,dur]word(start,dur)word(start,dur)         absolute times
 *
 * KRC payloads arrive as base64 → 4 magic bytes → XOR with a fixed 16-byte key → zlib
 * (the scheme is documented by the Lyricify helper library).
 */

import zlib from 'node:zlib';
import { makeLine, syl } from '../model.js';
import { normKey } from '../text.js';

const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

export function decodeKrc(base64) {
  const raw = Buffer.from(base64, 'base64').subarray(4);
  for (let i = 0; i < raw.length; i++) raw[i] ^= KRC_KEY[i % KRC_KEY.length];
  return zlib.inflateSync(raw).toString('utf8');
}

/** "Lyrics by: …", "作词：…" — credits the format gives timed words, but nobody sings. */
export const CREDIT_LINE =
  /^(?:lyrics?|words?|composed?|composer|arranged?|arranger|produced?|producer|written|music|作词|作曲|编曲|制作人|词|曲)\s*(?:by)?\s*[:：]/i;

const entities = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function build(words, start, end, titleHint, lineIndex) {
  const text = words.map((w) => w.text).join('').trim();
  if (!text || CREDIT_LINE.test(text)) return null;
  // The first rows of a KRC repeat "Title - Artist" as if it were sung.
  if (titleHint && lineIndex < 2 && normKey(text).startsWith(normKey(titleHint)) && normKey(text).includes(' ')) return null;
  return makeLine({ text: words, timestamp: start, endtime: end, isWordSynced: true });
}

/** KuGou KRC (already decoded). */
export function parseKrc(text, titleHint) {
  const lines = [];
  for (const row of text.split(/\r?\n/)) {
    const head = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) continue;
    const start = Number(head[1]);
    const words = [];
    for (const m of head[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)) {
      if (!m[3]) continue;
      const at = start + Number(m[1]);
      words.push(syl(m[3], at, at + Number(m[2]), { part: true }));
    }
    const line = build(words, start, start + Number(head[2]), titleHint, lines.length);
    if (line) lines.push(line);
  }
  return lines;
}

/** NetEase YRC. */
export function parseYrc(text) {
  const lines = [];
  for (const row of text.split(/\r?\n/)) {
    if (row.startsWith('{')) continue; // JSON credit rows
    const head = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) continue;
    const start = Number(head[1]);
    const words = [];
    for (const m of head[3].matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)) {
      if (!m[3]) continue;
      const at = Number(m[1]);
      words.push(syl(m[3], at, at + Number(m[2]), { part: true }));
    }
    const line = build(words, start, start + Number(head[2]), null, lines.length);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * QQ QRC, delivered as XML whose LyricContent attribute holds the lines. XML flattens the
 * newlines inside an attribute to spaces, so lines are found by their `[start,dur]` headers.
 * Returns { lines, title, artist } — QQ states which song it thinks this is, and it is checked.
 */
export function parseQrc(xmlOrText) {
  const attr = xmlOrText.match(/LyricContent\s*=\s*"([^"]*)"/i)?.[1];
  const body = attr ? entities(attr.replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : xmlOrText;
  const tag = (name) => body.match(new RegExp(`\\[${name}:([^\\]]*)\\]`, 'i'))?.[1]?.trim() || '';
  const title = tag('ti');
  const artist = tag('ar');
  const lines = [];
  for (const m of body.matchAll(/\[(\d+),(\d+)\]([\s\S]*?)(?=\[\d+,\d+\]|$)/g)) {
    const start = Number(m[1]);
    const text = m[3];
    const words = [];
    let offset = 0;
    for (const t of text.matchAll(/\((\d+),(\d+)\)/g)) {
      const word = entities(text.slice(offset, t.index));
      const at = Number(t[1]);
      if (word.trim()) words.push(syl(word, at, at + Number(t[2]), { part: true }));
      offset = t.index + t[0].length;
    }
    const line = build(words, start, start + Number(m[2]), title, lines.length);
    if (line) lines.push(line);
  }
  return { lines, title, artist };
}
