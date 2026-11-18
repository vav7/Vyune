import { chromium } from 'playwright';

async function main() {
  console.log('--- Launching Playwright browser ---');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  console.log('1. Navigating to http://localhost:3000');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  console.log('2. Clicking Play on Featured Hero track');
  const playHero = page.locator('button:has-text("Play")').first();
  await playHero.click();
  await page.waitForTimeout(2500);

  console.log('3. Opening FullScreen Player');
  const openFs = page.locator('button[aria-label="Open full screen player"]').first();
  await openFs.click();
  await page.waitForTimeout(2500);

  console.log('4. Selecting MV mode in the 3-mode pill');
  const mvBtn = page.locator('button:has-text("MV")').first();
  await mvBtn.waitFor({ state: 'visible', timeout: 5000 });
  await mvBtn.click({ force: true });
  console.log('Clicked MV mode button!');

  console.log('5. Waiting 6 seconds for video buffer & playback...');
  await page.waitForTimeout(6000);

  const report1 = await page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video'));
    const mv = vids.find(v => v.src.includes('/api/video/'));
    return mv ? {
      found: true,
      src: mv.src,
      paused: mv.paused,
      currentTime: mv.currentTime,
      duration: mv.duration,
      videoWidth: mv.videoWidth,
      videoHeight: mv.videoHeight,
      readyState: mv.readyState,
      computedOpacity: window.getComputedStyle(mv).opacity,
    } : { found: false, allVideos: vids.map(v => v.src) };
  });
  console.log('MV STATUS AFTER 6s:', JSON.stringify(report1, null, 2));

  console.log('6. Clicking Pause button in Transport controls...');
  const pauseBtn = page.locator('button[aria-label="Pause"]').first();
  await pauseBtn.waitFor({ state: 'visible', timeout: 5000 });
  await pauseBtn.click({ force: true });
  await page.waitForTimeout(1500);

  const report2 = await page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video'));
    const mv = vids.find(v => v.src.includes('/api/video/'));
    return mv ? { paused: mv.paused, currentTime: mv.currentTime } : null;
  });
  console.log('MV STATUS AFTER PAUSE BUTTON CLICK:', JSON.stringify(report2, null, 2));

  console.log('7. Clicking Play button to resume...');
  const playBtn = page.locator('button[aria-label="Play"]').first();
  await playBtn.waitFor({ state: 'visible', timeout: 5000 });
  await playBtn.click({ force: true });
  await page.waitForTimeout(2500);

  const report3 = await page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video'));
    const mv = vids.find(v => v.src.includes('/api/video/'));
    return mv ? { paused: mv.paused, currentTime: mv.currentTime } : null;
  });
  console.log('MV STATUS AFTER RESUME BUTTON CLICK:', JSON.stringify(report3, null, 2));

  await browser.close();

  const isPlayingInitially = report1.found && !report1.paused && report1.currentTime > 0;
  const isPausedCorrectly = report2 && report2.paused;
  const isResumedCorrectly = report3 && !report3.paused && report3.currentTime > report2.currentTime;

  if (isPlayingInitially && isPausedCorrectly && isResumedCorrectly) {
    console.log('>>> COMPLETE SUCCESS: ALL VIDEO & SYNC VERIFICATION TESTS PASSED! <<<');
    process.exit(0);
  } else {
    console.error('Verification failed. Detailed status:', { isPlayingInitially, isPausedCorrectly, isResumedCorrectly });
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
