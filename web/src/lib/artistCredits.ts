/* artistCredits.ts — the credit line, cut so every named artist can open its
 * own page while the byline still reads exactly as it was written.
 * Parallel artists[] / artistIds[] arrays. */

/**
 * Filter out any leaked play counts, view counts, tallies or timestamps from artist names.
 */
export function cleanArtistDisplay(name: string): string {
  if (!name || typeof name !== 'string') return '';
  const s = name.trim();
  if (/\b(?:plays?|views?|listeners?|subscribers?|streams?|monthly|audience|crore|cr|lakh)\b/i.test(s)) return '';
  if (/\b\d{1,2}(?::\d{2}){1,2}\b/.test(s)) return '';
  if (/^[\d.,\s]+[kmb]?$/i.test(s)) return '';
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s*\d{4}$/i.test(s)) return '';
  if (/^[•·|,&/–—\s\-:]+$/.test(s)) return '';
  return s;
}

export interface CreditSegment {
  text: string;
  /** The artist channel this stretch names, when the catalogue linked one. */
  id: string | null;
}

/** The marks a byline joins credits with, in every script. */
const CREDIT_JOINER = /(\s*,\s*|\s*，\s*|\s+&\s+|\s+＆\s+|\s*•\s*|\s*·\s*|\s*・\s*|\s*、\s*)/;

/**
 * The byline split into linkable stretches: each credited name (with its
 * channel id when the track carries one) and the plain joiners between them.
 */
export function creditSegments(line: string, artists: string[], artistIds?: (string | null | undefined)[]): CreditSegment[] {
  if (!line) return [];
  const parts = line.split(new RegExp(CREDIT_JOINER.source, 'g'));
  const names = artists.filter((a) => a && a.trim());
  // Match name pieces against the stated credits in order; joiners pass through.
  const segments: CreditSegment[] = [];
  let next = 0;
  for (const part of parts) {
    if (!part) continue;
    const trimmed = part.trim();
    const stated = names[next];
    if (trimmed && stated && sameName(trimmed, stated)) {
      segments.push({ text: part, id: artistIds?.[next] ?? null });
      next++;
    } else if (part.match(/^\s*[,&•·・、＆]\s*$/) || part.trim() === '&' || part.trim() === 'and') {
      segments.push({ text: part, id: null });
    } else {
      // A name the catalogue didn't itemize: link it by position if one remains.
      if (trimmed && next < names.length && sameName(trimmed, names[next]!)) {
        segments.push({ text: part, id: artistIds?.[next] ?? null });
        next++;
      } else {
        segments.push({ text: part, id: null });
      }
    }
  }
  return segments.length ? segments : [{ text: line, id: artistIds?.[0] ?? null }];
}

function sameName(a: string, b: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const fa = fold(a);
  const fb = fold(b);
  return fa === fb || fa.includes(fb) || fb.includes(fa);
}
