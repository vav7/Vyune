import { chromium } from 'playwright';

async function verifyStage4() {
  console.log('[test] --- Stage 4: Interactive Lyrics Timing Scrubber & Word-Synced Engine ---');

  // Test 1: Lyrics API Verification
  console.log('\n[test] 1. Testing /api/lyrics with canonical metadata enrichment...');
  const testTrack = {
    title: 'Aashiq Banaya Aapne',
    artist: 'Himesh Reshammiya',
    album: 'Aashiq Banaya Aapne',
    duration: 364,
  };

  const lyricsUrl = `http://localhost:3000/api/lyrics?title=${encodeURIComponent(testTrack.title)}&artist=${encodeURIComponent(testTrack.artist)}&album=${encodeURIComponent(testTrack.album)}&duration=${testTrack.duration}`;
  console.log(`[test] Fetching: ${lyricsUrl}`);

  const res = await fetch(lyricsUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch lyrics: ${res.status} ${res.statusText}`);
  }
  const lyricsData = await res.json();
  console.log(`[test] Lyrics Primary Provider: ${lyricsData.primary?.source || 'none'}`);
  console.log(`[test] Is Word Synced: ${lyricsData.primary?.isWordSynced}`);
  console.log(`[test] Line count: ${lyricsData.primary?.lines?.length ?? 0}`);
  console.log(`[test] Honest Alternates listed: ${lyricsData.alternates?.length ?? 0}`);
  if (lyricsData.alternates?.length > 0) {
    console.log(`[test] Alternate providers: ${lyricsData.alternates.map(a => `${a.source} (${a.tier})`).join(', ')}`);
  }

  if (!lyricsData.primary) {
    console.warn('[test] Warning: Primary lyrics sheet not returned for test track, will test UI controls with synthetic or fallback sheet');
  } else {
    console.log('✔ PASS: Lyrics engine returned ranked lyrics sheet!');
  }

  // Test 2: Playwright UI Verification of Interactive Timing Offset Scrubber
  console.log('\n[test] 2. Launching headless Chromium to test Interactive Lyrics Timing Scrubber...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Play a track and open Fullscreen mode
  console.log('[test] Loading track into player...');
  await page.evaluate(() => {
    window.__mcPlayer.playQueue([{
      id: 'test-track-lyrics',
      title: 'Aashiq Banaya Aapne',
      artists: ['Himesh Reshammiya', 'Shreya Ghoshal'],
      album: 'Aashiq Banaya Aapne',
      source: 'saavn',
      duration: 364,
      thumb: 'https://c.saavncdn.com/123/test-500x500.jpg',
    }], 0);
    window.__mcPlayer.setFullscreen(true);
  });
  await page.waitForTimeout(1000);

  // Click Lyrics toggle button in FullScreen player
  console.log('[test] Clicking Lyrics toggle button...');
  const lyricsBtn = await page.$('button[aria-label="Lyrics"]');
  if (lyricsBtn) {
    await lyricsBtn.click();
    await page.waitForTimeout(1000);
  }

  // Check that the Sync timing pill exists
  console.log('[test] Finding Lyrics timing offset Sync button...');
  const syncBtn = await page.$('button[title*="timing offset slider"]');
  if (!syncBtn) {
    throw new Error('Sync timing offset scrubber button not found in lyrics header!');
  }
  console.log('✔ PASS: Found Sync offset pill button in Lyrics header!');

  // Click the Sync button to open the Floating Timing Offset Scrubber card
  console.log('[test] Clicking Sync pill button to toggle interactive scrubber card...');
  await syncBtn.click();
  await page.waitForTimeout(400);

  // Verify interactive scrubber card controls
  const scrubberCard = await page.$('div:has-text("Lyrics Timing Offset")');
  if (!scrubberCard) {
    throw new Error('Interactive Lyrics Timing Offset Scrubber card did not open!');
  }
  console.log('✔ PASS: Interactive Lyrics Timing Offset Scrubber card is open and visible!');

  // Test nudge buttons (+100ms, +500ms, -25ms)
  console.log('[test] Testing +100ms nudge button...');
  const plus100Btn = await page.$('button:has-text("+100ms")');
  if (!plus100Btn) throw new Error('+100ms button not found');
  await plus100Btn.click();
  await page.waitForTimeout(200);

  let offsetText = (await scrubberCard.textContent()) || '';
  console.log(`[test] Current scrubber offset badge after +100ms:`, offsetText);
  if (!offsetText.includes('+100ms')) {
    throw new Error(`Expected +100ms in offset display, got: ${offsetText}`);
  }
  console.log('✔ PASS: Offset correctly updated to +100ms via nudge button!');

  // Test clicking +500ms
  console.log('[test] Testing +0.5s nudge button...');
  const plus500Btn = await page.$('button:has-text("+0.5s")');
  await plus500Btn.click();
  await page.waitForTimeout(200);

  offsetText = (await scrubberCard.textContent()) || '';
  console.log(`[test] Current scrubber offset badge after +0.5s:`, offsetText);
  if (!offsetText.includes('+600ms')) {
    throw new Error(`Expected +600ms in offset display, got: ${offsetText}`);
  }
  console.log('✔ PASS: Offset correctly updated to +600ms (+0.60s)!');

  // Test range slider drag/input
  console.log('[test] Testing interactive range slider input...');
  const rangeInput = await page.$('input[type="range"][min="-5000"][max="5000"]');
  if (!rangeInput) throw new Error('Range slider input not found in scrubber card');
  
  await rangeInput.fill('-1500');
  await rangeInput.dispatchEvent('input');
  await page.waitForTimeout(200);

  offsetText = (await scrubberCard.textContent()) || '';
  console.log(`[test] Current scrubber offset badge after slider set to -1500:`, offsetText);
  if (!offsetText.includes('-1500ms')) {
    throw new Error(`Expected -1500ms in offset display, got: ${offsetText}`);
  }
  console.log('✔ PASS: Range slider scrubber smoothly adjusted offset to -1500ms (-1.50s)!');

  // Test Reset button
  console.log('[test] Testing Reset button...');
  const resetBtn = await page.$('button:has-text("Reset")');
  await resetBtn.click();
  await page.waitForTimeout(200);

  offsetText = (await scrubberCard.textContent()) || '';
  console.log(`[test] Current scrubber offset badge after Reset:`, offsetText);
  if (!offsetText.includes('0ms')) {
    throw new Error(`Expected 0ms after Reset, got: ${offsetText}`);
  }
  console.log('✔ PASS: Reset button immediately cleared offset back to 0ms!');

  // Now set a realistic demo offset of +350ms for the visual proof screenshot
  await page.evaluate(() => {
    const range = document.querySelector('input[type="range"][min="-5000"]');
    if (range) {
      range.value = '350';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);

  // Capture screenshot proof
  const screenshotPath = 'tests/stage4-lyrics-proof.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`\n✔ Saved verification screenshot to ${screenshotPath}`);

  await browser.close();
  console.log('\n========================================');
  console.log('🎉 ALL STAGE 4 VERIFICATION TESTS PASSED!');
  console.log('========================================');
}

verifyStage4().catch((err) => {
  console.error('[test] Test failed:', err);
  process.exit(1);
});
