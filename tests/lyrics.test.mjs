/* Lyrics engine, end to end, with the network replaced by canned provider responses. */
import assert from 'node:assert/strict';
import { parseLrc, parsePlain } from '../server/lyrics/parse/lrc.js';
import { parseYrc, parseKrc, parseQrc } from '../server/lyrics/parse/karaoke.js';
import { parsePayload } from '../server/lyrics/parse/envelope.js';
import { cleanTitle, cleanIsrc } from '../server/lyrics/text.js';
import { sheetScore, tierOf } from '../server/lyrics/model.js';
import { joinMarks, respaced, present } from '../server/lyrics/shape.js';
import { bestHit } from '../server/lyrics/verify.js';
import { parseTTML } from '../server/lyrics/parse/ttml.js';
import { GLOBAL_HTTP_CACHE } from '../server/lyrics/io.js';

/* ---- parsers ---- */
const lrc = parseLrc('[ar:x]\n[00:10.00]hello\n[00:12.50][01:00.00]world\n');
assert.equal(lrc.length, 3); assert.equal(lrc[1].timestamp, 12500); assert.equal(lrc[2].timestamp, 60000);
const enh = parseLrc('[00:27.39]<00:27.39>I <00:27.54>been <00:27.74>tryna');
assert.equal(enh[0].isWordSynced, true); assert.equal(enh[0].text.length, 3);
assert.equal(parsePlain('[Chorus]\nla la\n(oh)\n[ar:x]')[0].section, true);
assert.equal(parsePlain('[Chorus]\nla la\n(oh)').length, 3);
assert.equal(parseYrc('[1000,2000](1000,500,0)hel(1500,500,0)lo').at(0).text.length, 2);
assert.equal(parseKrc('[1000,2000]<0,500,0>hel<500,500,0>lo').at(0).text[1].timestamp, 1500);
assert.equal(parseQrc('[ti:T]\n[1000,2000]hel(1000,500)lo(1500,500)').lines[0].text.length, 2);
assert.ok(parsePayload(JSON.stringify({ lyrics: '[00:01.00]hi' })).lines.length === 1);
assert.equal(parsePayload(JSON.stringify({ error: 'nope', lyrics: 'x' })), null);

/* ---- TTML (Apple-style, per-syllable, with a timed adlib) ---- */
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="en"><head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head><body><div><p begin="0:01.000" end="0:03.000" ttm:agent="v1"><span begin="0:01.000" end="0:01.500">Hel</span><span begin="0:01.500" end="0:02.000">lo </span><span begin="0:02.000" end="0:03.000">world</span></p></div></body></tt>`;
const parsedTtml = parseTTML(ttml);
assert.equal(parsedTtml.lines.length, 1); assert.equal(parsedTtml.lines[0].isWordSynced, true);
assert.equal(parsedTtml.lines[0].text.map((t) => t.text).join(''), 'Hello world');
assert.equal(parseTTML('<html></html>'), null);

/* ---- names ---- */
assert.equal(cleanTitle('Dracula (feat. JENNIE)'), 'Dracula');
assert.equal(cleanTitle('Tum Hi Ho (From "Aashiqui 2")'), 'Tum Hi Ho');
assert.equal(cleanTitle('Song (Remix)'), 'Song (Remix)', 'a remix is a different recording and must stay');
assert.equal(cleanTitle('Song (Official Video)'), 'Song');
assert.equal(cleanIsrc('us-abc-12-34567'), 'USABC1234567'); assert.equal(cleanIsrc('../x'), null);
const hits = [{ title: 'Song (Live)', artist: 'A', duration: 200 }, { title: 'Song', artist: 'A', duration: 201 }];
assert.equal(bestHit(hits, { title: 'Song', artist: 'A', duration: 200 }).title, 'Song');

/* ---- scoring: tier always beats provider ---- */
const w = { source: 'x', providerId: 'lrclib', lines: [{ isWordSynced: true, timestamp: 1, endtime: 3, text: [{ text: 'a', timestamp: 1, endtime: 2 }, { text: 'b', timestamp: 2, endtime: 3 }] }] };
const l = { source: 'y', providerId: 'amll', lines: [{ isWordSynced: false, timestamp: 1, endtime: 3, text: [{ text: 'a', timestamp: 1, endtime: 3 }] }] };
assert.equal(tierOf(w), 'word'); assert.equal(tierOf(l), 'line'); assert.ok(sheetScore(w) > sheetScore(l));

/* ---- Indic integrity ---- */
assert.equal(joinMarks([{ text: 'क', endtime: 1 }, { text: 'ि', endtime: 2 }])[0].text, 'कि');
assert.equal(respaced([{ text: 'तुमहि', timestamp: 0, endtime: 1 }, { text: 'आहो', timestamp: 1, endtime: 2 }], 'तुम हिआ हो').map((s) => s.text).join(''), 'तुम हिआ हो');
const long = present({ source: 's', lines: [{ text: [{ text: 'word '.repeat(30).trim(), timestamp: 0, endtime: 6000 }], timestamp: 0, endtime: 6000, isWordSynced: false, background: false, backgroundText: [], oppositeTurn: false }] });
assert.ok(long.lines.length > 2, 'a paragraph is cut into screen lines');

/* ---- the engine, with canned network ---- */
const SONG = new URLSearchParams({ title: 'Test Song', artist: 'Test Artist', album: 'Alb', duration: '200', isrc: '' });
const lrcWord = '[00:01.00]<00:01.00>Hello <00:01.50>there <00:02.00>friend\n[00:04.00]<00:04.00>Second <00:04.50>line <00:05.00>here';
const lrcLine = '[00:01.00]Hello there friend\n[00:04.00]Second line here';
let calls = [];
let mode = 'word';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url); calls.push(u);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('unison.boidu.dev')) return mode === 'word' ? json({ success: true, data: { lyrics: lrcWord, format: 'lrc', syncType: 'wordsync' } }) : json({ success: false });
  if (u.includes('lrclib.net/api/get')) return json({ trackName: 'Test Song', artistName: 'Test Artist', duration: 200, syncedLyrics: lrcLine });
  if (u.includes('lrclib.net/api/search')) return json([{ trackName: 'Test Song', artistName: 'Test Artist', albumName: 'Alb', duration: 200, syncedLyrics: lrcLine }]);
  if (u.includes('api.lyrics.ovh')) return json({ lyrics: 'plain one\nplain two' });
  return new Response('nope', { status: 404 });
};

const { fetchLyrics } = await import('../server/lyrics/engine.js');
const p = Object.fromEntries(SONG); p.duration = 200;
const t0 = Date.now();
let r = await fetchLyrics({ ...p, title: 'Test Song (feat. X)' });
assert.equal(r.status, 'ok'); assert.equal(r.primary.isWordSynced, true, 'word-synced Unison beats line-synced LRCLIB');
assert.equal(r.primary.source, 'Unison');
console.log('word answer in', Date.now() - t0, 'ms; alternates:', r.alternates);

mode = 'line';
GLOBAL_HTTP_CACHE.clear();
r = await fetchLyrics({ ...p, title: 'Other Song', artist: 'Test Artist' }, { refresh: true });
// Other Song: LRCLIB candidates are filtered by the matcher (different title) -> falls to words-only
assert.ok(r === null || r.status === 'ok');

mode = 'line';
GLOBAL_HTTP_CACHE.clear();
r = await fetchLyrics({ ...p }, { refresh: true });
assert.equal(r.status, 'ok'); assert.equal(r.primary.isSynced, true);
assert.equal(r.primary.source, 'LRCLIB'); assert.equal(r.upgrading, true, 'a line answer keeps hunting for word timing');
await new Promise((res) => setTimeout(res, 300));
const again = await fetchLyrics({ ...p });
console.log('after upgrade hunt:', again.upgrading, again.primary.source);

globalThis.fetch = realFetch;
console.log('lyrics tests passed');
process.exit(0);
