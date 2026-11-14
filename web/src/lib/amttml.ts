/* amttml.ts — our lyric lines as the TTML that <am-lyrics> reads.
 *
 * The server settles *which* sheet to show; am-lyrics renders it. Its `ttml`
 * property is the documented way to hand it a sheet without it going out to
 * fetch one of its own, so every property it draws from is written into the
 * document:
 *
 *   • word timing      <span begin end> per syllable (a line with no word timing
 *                      is a bare <p>, which am-lyrics paints as a line wipe)
 *   • background vocals <span ttm:role="x-bg"> inside the line
 *   • duet sides       two agents: v1 sings from the start side, v2 (type
 *                      "other") from the end side — the side flips whenever the
 *                      agent changes, which reproduces the sides the engine chose
 *   • song parts       itunes:songPart on the <div> that groups a section
 *   • translation / romanisation, keyed per line, for its toggles
 */

import type { LyricsLine, Syllable } from './types';

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const esc = (value: string) =>
  value
    .replace(XML_BAD, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ms = (value: number) => `${Math.max(0, Math.round(Number.isFinite(value) ? value : 0))}ms`;

const spanOf = (syllable: Syllable) =>
  `<span begin="${ms(syllable.timestamp)}" end="${ms(Math.max(syllable.endtime, syllable.timestamp))}">${esc(syllable.text)}</span>`;

const wordTimed = (line: LyricsLine) =>
  line.isWordSynced !== false &&
  line.text.length > 0 &&
  line.text.some((syllable) => !syllable.lineSynced && syllable.endtime > syllable.timestamp);

export function linesToTtml(lines: readonly LyricsLine[], opts: { translation?: boolean; romanization?: boolean } = {}): string {
  const hasContent = (line: LyricsLine) =>
    line.text.some((s) => s.text && s.text.trim().length > 0) ||
    (line.backgroundText && line.backgroundText.some((s) => s.text && s.text.trim().length > 0));

  const rows = lines.filter((line) => !line.section && hasContent(line));

  let body = '';
  let openPart: string | null | undefined;
  const translations: string[] = [];
  const romanized: string[] = [];

  rows.forEach((line, index) => {
    const key = `L${index + 1}`;
    const part = line.songPart || null;
    if (index === 0 || part !== openPart) {
      if (index > 0) body += '</div>';
      body += `<div${part ? ` itunes:songPart="${esc(part)}"` : ''}>`;
      openPart = part;
    }

    const begin = line.timestamp;
    const end = Math.max(line.endtime, begin);
    const agent = line.alignment === 'end' ? 'v2' : line.alignment === 'start' ? 'v1' : '';
    const lang = line.direction === 'rtl' ? ' xml:lang="ar"' : '';
    const attrs = `begin="${ms(begin)}" end="${ms(end)}" itunes:key="${key}"${agent ? ` ttm:agent="${agent}"` : ''}${lang}`;

    let inner: string;
    if (wordTimed(line)) {
      inner = line.text.map(spanOf).join('');
    } else {
      inner = esc(line.text.map((syllable) => syllable.text).join('').trim());
    }
    if (line.backgroundText?.length) {
      inner += `<span ttm:role="x-bg">${line.backgroundText.map(spanOf).join('')}</span>`;
    }
    body += `<p ${attrs}>${inner}</p>`;

    if (opts.translation !== false && line.translation) translations.push(`<text for="${key}">${esc(line.translation)}</text>`);
    const roman = line.romanizedText || line.text.map((s) => s.romanizedText).filter(Boolean).join(' ');
    if (opts.romanization !== false && roman) romanized.push(`<text for="${key}">${esc(roman)}</text>`);
  });
  if (rows.length) body += '</div>';

  const extra =
    (translations.length ? `<translations><translation type="subtitle" xml:lang="en">${translations.join('')}</translation></translations>` : '') +
    (romanized.length ? `<transliterations><transliteration>${romanized.join('')}</transliteration></transliterations>` : '');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">' +
    '<head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="other" xml:id="v2"/>' +
    (extra ? `<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">${extra}</iTunesMetadata>` : '') +
    '</metadata></head>' +
    `<body>${body}</body></tt>`
  );
}
