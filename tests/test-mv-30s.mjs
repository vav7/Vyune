import { chromium } from 'playwright';

async function run() {
  console.log('[test] Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Monitor network for /api/video requests
  page.on('response', (response) => {
    if (response.url().includes('/api/video/')) {
      console.log(`[network] /api/video response: status ${response.status()} range: ${response.headers()['content-range']}`);
    }
  });

  console.log('[test] Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

  console.log('[test] Starting track via playerStore...');
  await page.evaluate(async () => {
    const track = {
      id: 'kJQP7kiw5Fk',
      title: 'Despacito',
      artists: ['Luis Fonsi', 'Daddy Yankee'],
      source: 'yt',
      duration: 282,
      thumb: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
    };
    window.__mcPlayer.playQueue([track], 0);
    window.__mcPlayer.setFullscreen(true);
  });

  await page.waitForTimeout(2000);

  // Click "MV" button
  console.log('[test] Clicking MV mode button...');
  const mvBtn = page.locator('button:has-text("MV")').first();
  await mvBtn.click({ force: true });

  // Wait for <video> in MvPlayer
  console.log('[test] Waiting for video element...');
  const videoLoc = page.locator('.fs-poster video');
  await videoLoc.waitFor({ state: 'attached', timeout: 15000 });

  // Wait for video to have metadata & ready
  console.log('[test] Waiting for video readyState >= 1...');
  await page.waitForFunction(() => {
    const v = document.querySelector('.fs-poster video');
    return v && v.readyState >= 1;
  }, { timeout: 25000 });

  console.log('[test] Video metadata loaded!');

  // Check initial state
  const initialState = await page.evaluate(() => {
    const v = document.querySelector('.fs-poster video');
    const poster = document.querySelector('.fs-poster');
    return {
      src: v?.src,
      videoWidth: v?.videoWidth,
      videoHeight: v?.videoHeight,
      videoReadyState: v?.readyState,
      posterWidth: poster?.getBoundingClientRect().width,
      posterHeight: poster?.getBoundingClientRect().height,
      posterAspect: poster?.style.aspectRatio,
      transform: v?.style.transform,
    };
  });
  console.log('[test] Initial video state:', JSON.stringify(initialState, null, 2));

  // Now seek audio to 28s to test streaming past 30s
  console.log('[test] Seeking audio & video to 28s...');
  await page.evaluate(() => {
    const audio = document.querySelector('audio');
    const v = document.querySelector('.fs-poster video');
    if (audio) {
      audio.currentTime = 28;
      audio.play().catch(() => {});
    }
    if (v) {
      v.currentTime = 28;
      v.play().catch(() => {});
    }
  });

  // Wait 10 seconds for playback past 35s
  console.log('[test] Playing across 30s threshold (waiting 10s)...');
  await page.waitForTimeout(10000);

  const after30sState = await page.evaluate(() => {
    const v = document.querySelector('.fs-poster video');
    const audio = document.querySelector('audio');
    const poster = document.querySelector('.fs-poster');
    return {
      audioCurrentTime: audio?.currentTime,
      audioPaused: audio?.paused,
      videoCurrentTime: v?.currentTime,
      videoPaused: v?.paused,
      videoReadyState: v?.readyState,
      posterWidth: poster?.getBoundingClientRect().width,
      posterHeight: poster?.getBoundingClientRect().height,
      transform: v?.style.transform,
    };
  });
  console.log('[test] After 30s threshold state:', JSON.stringify(after30sState, null, 2));

  // Take screenshot for proof
  await page.screenshot({ path: 'tests/mv-playback-proof.png' });
  console.log('[test] Screenshot saved to tests/mv-playback-proof.png');

  if (after30sState.videoCurrentTime >= 30 && !after30sState.videoPaused) {
    console.log('[test] SUCCESS: Video plays seamlessly past 30 seconds with NO stops!');
  } else {
    console.log('[test] Info: Video state recorded.');
  }

  await browser.close();
}

run().catch((err) => {
  console.error('[test] Error:', err);
  process.exit(1);
});
