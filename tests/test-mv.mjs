import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  console.log('Page loaded. Title:', await page.title());

  // Click on the first track in charts or shelves to play it
  const trackRow = page.locator('[data-track-row], tr, button').filter({ hasText: /play|song/i }).first();
  // Or find play button
  const playButton = page.locator('button[aria-label="Play"]').first();
  if (await playButton.count() > 0) {
    await playButton.click();
    console.log('Clicked play button');
  } else {
    // Click on any song card
    const card = page.locator('div[class*="card"], div[class*="shelf"]').first();
    if (await card.count() > 0) {
      await card.click();
      console.log('Clicked song card');
    }
  }

  await page.waitForTimeout(2000);

  // Open FullScreen player
  const fsBtn = page.locator('button[aria-label="Open full screen player"]').first();
  if (await fsBtn.count() > 0) {
    await fsBtn.click();
    console.log('Opened full screen player');
  }
  await page.waitForTimeout(1500);

  // Click MV mode button
  const mvBtn = page.locator('button:has-text("MV")').first();
  if (await mvBtn.count() > 0) {
    await mvBtn.click();
    console.log('Clicked MV mode button');
  }

  await page.waitForTimeout(4000);

  const video = page.locator('video').first();
  if (await video.count() > 0) {
    const state = await video.evaluate((v) => ({
      src: v.src,
      currentSrc: v.currentSrc,
      paused: v.paused,
      readyState: v.readyState,
      currentTime: v.currentTime,
      duration: v.duration,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      networkState: v.networkState,
      error: v.error ? { code: v.error.code, message: v.error.message } : null,
    }));
    console.log('=== VIDEO ELEMENT STATE ===');
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log('No video element found in DOM');
  }

  await browser.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
