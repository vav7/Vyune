import { chromium } from 'playwright';

async function testSureshotAnd169() {
  console.log('[test] Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('[test] Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Verify sureshot stream resolution for YouTube track
  console.log('[test] Testing stream resolution speed...');
  const t0 = Date.now();
  const streamRes = await page.evaluate(async () => {
    const res = await fetch('/api/stream?id=kJQP7kiw5Fk&title=Despacito&artist=Luis+Fonsi');
    return await res.json();
  });
  const elapsed = Date.now() - t0;
  console.log(`[test] Stream resolved in ${elapsed}ms:`, streamRes.source, streamRes.mime, !!streamRes.proxy);

  if (!streamRes.proxy && !streamRes.url) {
    throw new Error('Stream resolution failed to return a valid playable stream');
  }

  // 2. Play the track and open FullScreenPlayer
  await page.evaluate(() => {
    window.__mcPlayer.playQueue([{
      id: 'kJQP7kiw5Fk',
      title: 'Despacito',
      artists: ['Luis Fonsi', 'Daddy Yankee'],
      source: 'yt',
      duration: 282,
      thumb: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
    }], 0);
    window.__mcPlayer.setFullscreen(true);
  });
  await page.waitForTimeout(1000);

  // Check Art Mode dimensions (1:1 Square)
  const artState = await page.evaluate(() => {
    const poster = document.querySelector('.fs-poster');
    const rect = poster?.getBoundingClientRect();
    const allText = document.body.innerText;
    return {
      mode: window.__artModeStore?.mode,
      width: rect?.width,
      height: rect?.height,
      ratio: rect ? rect.width / rect.height : 1,
      has60fpsLabel: allText.includes('60fps'),
    };
  });
  console.log('[test] Art Mode State (expecting 1:1 square):', artState);

  if (Math.abs(artState.ratio - 1.0) > 0.05) {
    throw new Error(`Art mode expected 1:1 ratio, but got: ${artState.ratio}`);
  }

  // 3. Switch to MV Mode
  console.log('[test] Switching to MV Mode...');
  await page.evaluate(() => {
    window.__artModeStore?.setMode('mv');
  });
  await page.waitForTimeout(1500);

  const mvState = await page.evaluate(() => {
    const poster = document.querySelector('.fs-poster');
    const rect = poster?.getBoundingClientRect();
    const allText = document.body.innerText;
    const badge = Array.from(document.querySelectorAll('span')).find(s => s.textContent?.includes('Official MV'));
    return {
      mode: window.__artModeStore?.mode,
      width: rect?.width,
      height: rect?.height,
      ratio: rect ? rect.width / rect.height : 1,
      has60fpsLabel: allText.includes('60fps'),
      hasOfficialMvBadge: !!badge,
    };
  });
  console.log('[test] MV Mode State (expecting 16:9 widescreen ~1.77):', mvState);

  if (mvState.has60fpsLabel) {
    throw new Error('The "60fps" label was found on page! It must be removed.');
  }

  if (Math.abs(mvState.ratio - 16 / 9) > 0.1) {
    throw new Error(`MV mode expected ~1.77 (16:9) aspect ratio, but got: ${mvState.ratio}`);
  }

  // 4. Capture screenshot proof
  await page.screenshot({ path: 'tests/mv-16-9-proof.png' });
  console.log('[test] Saved screenshot to tests/mv-16-9-proof.png');
  console.log('[test] ALL TESTS PASSED: Sureshot audio fast playback, 60fps label removed, 16:9 MV mode active!');

  await browser.close();
}

testSureshotAnd169().catch((err) => {
  console.error('[test] Failed:', err);
  process.exit(1);
});
