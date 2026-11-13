/**
 * parse/envelope.js — "some lyric string inside some JSON" → lines.
 *
 * Smaller providers wrap the same lyric string in one or two JSON envelopes
 * under keys that differ host to host. This finds the string, works out what
 * it is (TTML, QRC, LRC or plain) and parses it.
 */

import { parseTTML } from './ttml.js';
import { parseQrc } from './karaoke.js';
import { parseLrc, parsePlain } from './lrc.js';

const KEYS = ['ttml', 'ttmlContent', 'lyrics', 'lrc', 'content', 'text', 'plainLyrics', 'syncedLyrics', 'line', 'lines', 'lyric', 'data', 'result', 'response'];

function extract(node, depth = 0) {
  if (node == null || depth > 6) return null;
  if (typeof node === 'string') {
    const text = node.trim();
    if (/^[{[]/.test(text)) {
      try {
        const nested = extract(JSON.parse(text), depth + 1);
        if (nested) return nested;
      } catch {
        // not JSON after all: it is the lyric itself
      }
    }
    return text || null;
  }
  if (Array.isArray(node)) return node.map((n) => extract(n, depth + 1)).filter(Boolean).join('\n') || null;
  if (typeof node === 'object') {
    if (node.isError === true || node.ok === false || (node.error && node.error !== false && node.error !== '')) return null;
    for (const key of KEYS) {
      const found = extract(node[key], depth + 1);
      if (found) return found;
    }
    return extract(node.metadata, depth + 1) || extract(node.words, depth + 1);
  }
  return null;
}

/** The lyric string inside a provider's response, or null. */
export function unwrap(raw) {
  let value = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (value.startsWith('```')) value = value.split('\n').slice(1).filter((l) => l.trim() !== '```').join('\n').trim();
  if (!value) return null;
  try {
    return extract(JSON.parse(value));
  } catch {
    return value;
  }
}

const unescapeTtml = (s) =>
  /&lt;tt/i.test(s) ? s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&') : s;

/** Parse whatever the provider sent. Returns { lines, songwriters?, title?, artist? } or null. */
export function parsePayload(raw) {
  const content = unwrap(raw);
  if (!content) return null;
  const text = unescapeTtml(content);

  if (/<tt(?:\s|>)/i.test(text) || /w3\.org\/ns\/ttml/i.test(text)) {
    const parsed = parseTTML(text);
    return parsed?.lines?.length ? parsed : null;
  }
  if (/\[\d+,\d+\][^\n]*\(\d+,\d+/.test(text)) {
    const { lines, title, artist } = parseQrc(text);
    return lines.length ? { lines, title, artist } : null;
  }
  if (text.trimStart().startsWith('<')) return null; // some other XML: not lyrics
  const timed = parseLrc(text);
  if (timed.length) return { lines: timed };
  if (/\b(?:lyrics? (?:not found|unavailable)|error)\b/i.test(text)) return null;
  const plain = parsePlain(text);
  return plain.length ? { lines: plain } : null;
}
