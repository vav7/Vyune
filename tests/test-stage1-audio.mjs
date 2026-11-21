import { chromium } from 'playwright';

async function verifyStage1() {
  console.log('[test] 1. Testing JioSaavn #1 Stream Priority on /api/stream...');

  const t0 = Date.now();
  const res = await fetch('http://localhost:3000/api/stream?id=NJAv_7lHUIU&title=Kesariya&artist=Pritam,+Arijit+Singh&album=Brahmastra&refresh=1');
  const stream = await res.json();
  const latency = Date.now() - t0;

  console.log(`[test] Stream response in ${latency}ms:`, {
    source: stream.source,
    bitrate: stream.bitrate,
    mime: stream.mime,
    urlPrefix: stream.url?.slice(0, 45) + '...',
  });

  if (stream.source !== 'saavn' || stream.bitrate !== 320000) {
    throw new Error(`Expected JioSaavn 320kbps stream, but got: source=${stream.source}, bitrate=${stream.bitrate}`);
  }

  console.log('[test] 2. Testing repeat/cached resolution speed...');
  const t1 = Date.now();
  const res2 = await fetch('http://localhost:3000/api/stream?id=NJAv_7lHUIU&title=Kesariya&artist=Pritam,+Arijit+Singh&album=Brahmastra');
  const stream2 = await res2.json();
  const cachedLatency = Date.now() - t1;
  console.log(`[test] Cached stream resolved in ${cachedLatency}ms (source: ${stream2.source})`);

  if (cachedLatency > 100) {
    console.warn(`[test] Warning: Cached latency (${cachedLatency}ms) was slightly higher than ideal`);
  }

  console.log('[test] 3. Testing YouTube clean studio fallback (when track not on Saavn)...');
  // Obscure / YouTube-only track query
  const ytRes = await fetch('http://localhost:3000/api/stream?id=kJQP7kiw5Fk&title=Despacito+Instrumental+Audio+Track&artist=Luis+Fonsi');
  const ytStream = await ytRes.json();
  console.log('[test] YouTube fallback result:', {
    source: ytStream.source,
    mime: ytStream.mime,
    hasProxy: !!ytStream.proxy,
  });

  if (!ytStream.proxy && !ytStream.url) {
    throw new Error('YouTube fallback failed to return stream');
  }

  console.log('[test] 4. Launching headless browser to verify real audio playback...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Play Kesariya in browser
  await page.evaluate(() => {
    window.__mcPlayer.playQueue([{
      id: 'NJAv_7lHUIU',
      title: 'Kesariya',
      artists: ['Pritam', 'Arijit Singh'],
      album: 'Brahmastra',
      duration: 268,
      thumb: 'https://i.ytimg.com/vi/NJAv_7lHUIU/hqdefault.jpg',
      source: 'yt'
    }], 0);
  });

  await page.waitForTimeout(2000);

  const audioState = await page.evaluate(() => {
    const a = window.__mcAudio;
    return {
      paused: a?.paused,
      currentTime: a?.currentTime,
      duration: a?.duration,
      srcPrefix: a?.src?.slice(0, 45) + '...',
      isSaavnCdn: a?.src?.includes('saavncdn.com'),
    };
  });
  console.log('[test] Browser Audio Element State:', audioState);

  if (!audioState.isSaavnCdn) {
    throw new Error(`Expected audio.src to be Saavn 320kbps CDN URL, but got: ${audioState.srcPrefix}`);
  }

  console.log('[test] All Stage 1 tests passed successfully!');
  await browser.close();
}

verifyStage1().catch((err) => {
  console.error('[test] Stage 1 verification failed:', err);
  process.exit(1);
});
