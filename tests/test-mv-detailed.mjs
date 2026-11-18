import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));

  console.log('1. Loading http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click on the first playable track card or row
  console.log('2. Clicking first track card...');
  const card = page.locator('.track-card, [data-track-id], button:has(img)').first();
  await card.click();
  console.log('Clicked card');

  await page.waitForTimeout(3000);

  // Open FullScreen player
  console.log('3. Opening full screen player...');
  const openFs = page.locator('button[aria-label="Open full screen player"]').first();
  if (await openFs.count() > 0) {
    await openFs.click();
    console.log('Opened full screen player');
  } else {
    // try clicking LCD
    const lcd = page.locator('.group\\/lcd button').first();
    if (await lcd.count() > 0) {
      await lcd.click();
      console.log('Clicked LCD to open fullscreen');
    }
  }

  await page.waitForTimeout(2000);

  // Click MV mode button
  console.log('4. Selecting MV mode...');
  const mvBtn = page.locator('button:has-text("MV")').first();
  if (await mvBtn.count() > 0) {
    await mvBtn.click();
    console.log('Clicked MV mode button');
  }

  // Wait 4 seconds for video to load and play
  console.log('5. Waiting 4s for playback...');
  await page.waitForTimeout(4000);

  // Check state
  const report = await page.evaluate(() => {
    const audioEl = document.querySelector('audio');
    const videos = Array.from(document.querySelectorAll('video'));
    return {
      audio: audioEl ? {
        src: audioEl.src,
        paused: audioEl.paused,
        currentTime: audioEl.currentTime,
        duration: audioEl.duration,
        readyState: audioEl.readyState,
        error: audioEl.error?.message,
      } : 'No audio element',
      videos: videos.map(v => ({
        src: v.src,
        currentSrc: v.currentSrc,
        paused: v.paused,
        currentTime: v.currentTime,
        duration: v.duration,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        readyState: v.readyState,
        networkState: v.networkState,
        error: v.error ? { code: v.error.code, message: v.error.message } : null,
      })),
    };
  });

  console.log('=== PLAYBACK REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
