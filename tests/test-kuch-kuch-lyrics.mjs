import { createIo } from '../server/lyrics/io.js';
import amll from '../server/lyrics/providers/amll.js';
import lrcred from '../server/lyrics/providers/lrcred.js';
import bini from '../server/lyrics/providers/bini.js';
import netease from '../server/lyrics/providers/netease.js';
import kugou from '../server/lyrics/providers/kugou.js';
import unison from '../server/lyrics/providers/unison.js';
import lrclib from '../server/lyrics/providers/lrclib.js';
import yt from '../server/lyrics/providers/yt.js';
import * as betterlyrics from '../server/lyrics/providers/betterlyrics.js';
import { fetchLyrics } from '../server/lyrics/engine.js';

const ctx = {
  title: 'Kuch Kuch Hota Hai',
  artist: 'Udit Narayan, Alka Yagnik',
  album: 'Kuch Kuch Hota Hai',
  duration: 296,
};

const io = createIo();

console.log('Testing Kuch Kuch Hota Hai against all providers...\n');

const providers = [
  { name: 'amll', p: amll },
  { name: 'lrcred', p: lrcred },
  { name: 'bini', p: bini },
  { name: 'netease', p: netease },
  { name: 'kugou', p: kugou },
  { name: 'betterlyrics-ttml', p: betterlyrics.ttml },
  { name: 'betterlyrics-qq', p: betterlyrics.qq },
  { name: 'betterlyrics-kugou', p: betterlyrics.kugou },
  { name: 'unison', p: unison },
  { name: 'lrclib', p: lrclib },
  { name: 'yt', p: yt },
];

for (const { name, p } of providers) {
  try {
    const t0 = Date.now();
    const res = await p.run(ctx, io);
    const ms = Date.now() - t0;
    if (!res) {
      console.log(`[${name}] (${ms}ms) -> null`);
    } else {
      const lineCount = res.lines?.length || 0;
      const isWord = res.lines?.some(l => l.isWordSynced);
      const firstLine = res.lines?.[0]?.text?.map ? res.lines[0].text.map(t => t.text).join('') : (res.lines?.[0]?.text || '');
      console.log(`[${name}] (${ms}ms) -> SUCCESS! ${lineCount} lines, wordSynced: ${isWord}, firstLine: "${firstLine}"`);
    }
  } catch (err) {
    console.log(`[${name}] ERROR:`, err.message);
  }
}

console.log('\nTesting full engine fetchLyrics:');
const full = await fetchLyrics(ctx, { refresh: true });
console.log('Engine Winner:', full?.primary?.source, 'isWordSynced:', full?.primary?.isWordSynced, 'estimated:', full?.primary?.estimated);
if (full?.primary?.lines?.length) {
  console.log('Sample line 0:', JSON.stringify(full.primary.lines[0]));
  console.log('Sample line 1:', JSON.stringify(full.primary.lines[1]));
}
console.log('Alternates:', full?.alternates);
