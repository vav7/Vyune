/**
 * parse/ttml.js — Apple-style TTML → lyric lines.
 *
 * Ported from @uimaxbai/am-lyrics (MPL-2.0). Handles per-syllable spans, timed
 * background vocals (adlibs), agents (who sings a line) and RTL languages.
 * Returns { lines, songwriters } or null when the document has no lyrics.
 */

import { DOMParser, Element } from '@xmldom/xmldom';
import { syl } from '../model.js';

/* ================================================================== */
/* TTML parser (ported from @uimaxbai/am-lyrics, MPL-2.0)              */
/* ================================================================== */

function parseTTMLTime(value, fallback = 0) {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  const unitMatch = normalized.match(/^(-?\d+(?:\.\d+)?)(ms|h|m|s)$/);
  if (unitMatch) {
    const amount = Number(unitMatch[1]);
    const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unitMatch[2]];
    return Math.max(0, Math.round(amount * mult));
  }
  const parts = normalized.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return fallback;
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 1) [seconds] = parts;
  else return fallback;
  return Math.max(0, Math.round(seconds * 1000));
}

function isRTL(language) {
  if (!language) return false;
  const p = language.toLowerCase().split(/[-_]/)[0];
  return ['ar', 'dv', 'fa', 'he', 'ku', 'ps', 'ur', 'yi'].includes(p);
}

function calculateLineAlignments(lineSingers, agentTypes) {
  const assign = new Array(lineSingers.length).fill(undefined);
  let leftIsStart = true;
  let lastPerson = null;
  let right = 0;
  let total = 0;
  lineSingers.forEach((singerId, index) => {
    let side;
    if (singerId) {
      let type = agentTypes[singerId];
      if (!type) type = singerId === 'v1000' ? 'group' : singerId === 'v2000' ? 'other' : 'person';
      if (type === 'group') side = 'start';
      else {
        if (lastPerson === null) leftIsStart = type !== 'other';
        else if (singerId !== lastPerson) leftIsStart = !leftIsStart;
        side = leftIsStart ? 'start' : 'end';
        lastPerson = singerId;
      }
    }
    if (side) {
      total++;
      if (side === 'end') right++;
    }
    assign[index] = side;
  });
  if (total > 0 && Math.round((right / total) * 100) >= 85) {
    for (let i = 0; i < assign.length; i++) {
      if (assign[i] === 'start') assign[i] = 'end';
      else if (assign[i] === 'end') assign[i] = 'start';
    }
  }
  return assign;
}

export function parseTTML(ttmlString) {
  try {
    const parser = new DOMParser({
      // xmldom >= 0.9: onError must be a function; tolerate warnings/errors,
      // only fatal parse errors should abort.
      onError: (level, msg) => {
        if (level === 'fatalError') throw new Error(msg);
      },
    });
    const doc = parser.parseFromString(ttmlString, 'text/xml');

    const translations = {};
    const transliterations = {};
    const agentMap = {};
    const documentLanguage =
      doc.documentElement.getAttribute('xml:lang') || doc.documentElement.getAttribute('lang');

    const agents = doc.getElementsByTagName('ttm:agent');
    for (let i = 0; i < agents.length; i++) {
      const id = agents[i].getAttribute('xml:id');
      const type = agents[i].getAttribute('type');
      if (id && type) agentMap[id] = type;
    }

    let songwriters;
    const swNodes = doc.getElementsByTagName('songwriter');
    if (swNodes.length > 0) {
      const names = [];
      for (let i = 0; i < swNodes.length; i++) if (swNodes[i].textContent) names.push(swNodes[i].textContent);
      if (names.length) songwriters = names.join(', ');
    }

    const trNodes = doc.getElementsByTagName('translation');
    for (let i = 0; i < trNodes.length; i++) {
      const texts = trNodes[i].getElementsByTagName('text');
      for (let j = 0; j < texts.length; j++) {
        const key = texts[j].getAttribute('for');
        if (key && texts[j].textContent) translations[key] = texts[j].textContent;
      }
    }

    const tlNodes = doc.getElementsByTagName('transliteration');
    for (let i = 0; i < tlNodes.length; i++) {
      const texts = tlNodes[i].getElementsByTagName('text');
      for (let j = 0; j < texts.length; j++) {
        const textNode = texts[j];
        const key = textNode.getAttribute('for');
        if (!key) continue;
        const spans = Array.from(textNode.getElementsByTagName('span')).filter((s) => s.getAttribute('begin'));
        if (spans.length > 0) {
          const syllabus = [];
          let fullText = '';
          for (const span of spans) {
            let spanText = span.textContent || '';
            const nextNode = span.nextSibling;
            if (nextNode && nextNode.nodeType === 3 && /^\s/.test(nextNode.textContent || '') && !spanText.endsWith(' ')) spanText += ' ';
            if (!spanText.trim()) continue;
            syllabus.push({
              time: parseTTMLTime(span.getAttribute('begin')),
              duration: parseTTMLTime(span.getAttribute('end')) - parseTTMLTime(span.getAttribute('begin')),
              text: spanText,
            });
            fullText += spanText;
          }
          transliterations[key] = { text: fullText.trim(), syllabus };
        } else if (textNode.textContent) {
          transliterations[key] = { text: textNode.textContent.trim().replace(/\s+/g, ' ') };
        }
      }
    }

    const lines = [];
    const pNodes = doc.getElementsByTagName('p');
    for (let i = 0; i < pNodes.length; i++) {
      const p = pNodes[i];
      const key =
        p.getAttributeNS('http://lrc.red/lyric-ttml-internal', 'key') || p.getAttribute('itunes:key');
      const beginMs = parseTTMLTime(p.getAttribute('begin'));
      const endMs = parseTTMLTime(p.getAttribute('end'), beginMs);
      const agentId = p.getAttribute('ttm:agent') || undefined;
      const lineLanguage = p.getAttribute('xml:lang') || p.getAttribute('lang') || documentLanguage;

      let songPart;
      if (p.parentNode && p.parentNode.tagName === 'div') {
        songPart =
          p.parentNode.getAttributeNS('http://lrc.red/lyric-ttml-internal', 'songPart') ||
          p.parentNode.getAttribute('itunes:songPart') ||
          undefined;
      }

      const mainSyllables = [];
      const bgSyllables = [];
      const spans = p.getElementsByTagName('span');
      const timedMainSpans = Array.from(spans).filter((span) => {
        const isBg =
          span.getAttribute('ttm:role') === 'x-bg' ||
          span.parentNode?.getAttribute?.('ttm:role') === 'x-bg';
        return !isBg && Boolean(span.getAttribute('begin')) && Boolean(span.getAttribute('end'));
      });
      // Some TTML files wrap an entire line in one timed span, or give every
      // word the same interval. That is line timing, not word karaoke.
      const hasWordLevelSync = timedMainSpans.length > 1 && new Set(
        timedMainSpans.map((span) => `${span.getAttribute('begin')}|${span.getAttribute('end')}`),
      ).size > 1;

      for (let j = 0; j < spans.length; j++) {
        const span = spans[j];
        if (span.getAttribute('ttm:role') === 'x-bg') {
          const inner = span.getElementsByTagName('span');
          for (let k = 0; k < inner.length; k++) {
            let bgText = inner[k].textContent || '';
            const nn = inner[k].nextSibling;
            if (nn && nn.nodeType === 3 && /^\s/.test(nn.textContent || '') && !bgText.endsWith(' ')) bgText += ' ';
            const ts = parseTTMLTime(inner[k].getAttribute('begin'), beginMs);
            bgSyllables.push({
              text: bgText,
              timestamp: ts,
              endtime: Math.max(ts, parseTTMLTime(inner[k].getAttribute('end'), endMs)),
              part: !/\s$/.test(bgText),
            });
          }
          continue;
        }
        if (span.parentNode?.getAttribute?.('ttm:role') === 'x-bg') continue;

        let text = span.textContent || '';
        const nn = span.nextSibling;
        if (nn && nn.nodeType === 3 && /^\s/.test(nn.textContent || '') && !text.endsWith(' ')) text += ' ';
        const ts = parseTTMLTime(span.getAttribute('begin'), beginMs);
        mainSyllables.push({
          text,
          timestamp: ts,
          endtime: Math.max(ts, parseTTMLTime(span.getAttribute('end'), endMs)),
          part: !/\s$/.test(text),
        });
      }

      if (mainSyllables.length === 0) {
        const primary = Array.from(p.childNodes)
          .filter((node) => !(node instanceof Element && node.getAttribute('ttm:role') === 'x-bg'))
          .map((node) => node.textContent || '')
          .join('')
          .trim();
        if (!primary) continue;
        mainSyllables.push(syl(primary, beginMs, endMs, { lineSynced: true }));
      }

      // distribute line-level transliteration onto syllables (romanization)
      const tlItem = key ? transliterations[key] : undefined;
      if (tlItem && mainSyllables.length > 1 && spans.length > 0) {
        if (tlItem.syllabus && tlItem.syllabus.length === mainSyllables.length) {
          mainSyllables.forEach((s, idx) => { s.romanizedText = tlItem.syllabus[idx].text; });
        } else {
          const romanWords = (tlItem.text || '').split(/\s+/).filter(Boolean);
          const groups = [];
          for (let si = 0; si < mainSyllables.length; si++) {
            if (mainSyllables[si].part && groups.length > 0) groups[groups.length - 1].push(si);
            else groups.push([si]);
          }
          if (romanWords.length === groups.length) groups.forEach((g, gi) => { mainSyllables[g[0]].romanizedText = romanWords[gi]; });
          else if (romanWords.length === mainSyllables.length) mainSyllables.forEach((s, idx) => { s.romanizedText = romanWords[idx]; });
        }
      }

      const resolvedBegin = p.getAttribute('begin')
        ? beginMs
        : Math.min(...mainSyllables.map((s) => s.timestamp));
      const resolvedEnd = Math.max(
        endMs,
        resolvedBegin,
        ...mainSyllables.map((s) => s.endtime),
        ...bgSyllables.map((s) => s.endtime),
      );

      lines.push({
        text: mainSyllables,
        background: bgSyllables.length > 0,
        backgroundText: bgSyllables,
        timestamp: resolvedBegin,
        endtime: resolvedEnd,
        isWordSynced: hasWordLevelSync,
        songPart,
        translation: key ? translations[key] : undefined,
        romanizedText: tlItem?.text,
        oppositeTurn: false,
        agentId,
        direction: p.getAttribute('dir') === 'rtl' || isRTL(lineLanguage) ? 'rtl' : undefined,
      });
    }

    if (!lines.length) return null;
    const sorted = lines
      .map((line, sourceIndex) => ({ line, sourceIndex }))
      .sort((a, b) => a.line.timestamp - b.line.timestamp || a.sourceIndex - b.sourceIndex)
      .map((x) => x.line);
    const alignments = calculateLineAlignments(
      sorted.map((l) => l.agentId),
      agentMap,
    );
    const aligned = sorted.map((line, index) => ({
      ...line,
      alignment: alignments[index],
      oppositeTurn: alignments[index] === 'end',
    }));
    return { lines: aligned, songwriters };
  } catch (e) {
    console.error('[lyrics] TTML parse failed:', e.message);
    return null;
  }
}
