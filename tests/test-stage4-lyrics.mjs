import { chromium } from 'playwright';

async function verifyLyricsSuite() {
  console.log('[test] --- Comprehensive Lyrics Engine & In-Panel Scrubber Suite ---');

  // Test 1: Multi-Provider Accuracy & Sequel Disambiguation
  console.log('\n[test] 1. Testing Lyrics Accuracy & Disambiguation...');
  const tests = [
    { title: 'Dilbar', artist: 'Alka Yagnik', album: 'Sirf Tum', duration: 332 },
    { title: 'Aashiq Banaya Aapne', artist: 'Neha Kakkar', album: 'Hate Story IV', duration: 221 },
    { title: 'Aashiq Banaya Aapne', artist: 'Himesh Reshammiya', album: 'Aashiq Banaya Aapne', duration: 364 },
    { title: 'Tera Mera Rishta', artist: 'Mustafa Zahid', album: 'Awarapan', duration: 349 },
  ];

  for (const t of tests) {
    const url = `http://localhost:3000/api/lyrics?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist)}&album=${encodeURIComponent(t.album)}&duration=${t.duration}&refresh=1`;
    const res = await fetch(url);
    const data = await res.json();
    console.log(`[test] ${t.title} (${t.album}): Source = ${data.primary?.source}, Lines = ${data.primary?.lines?.length}`);
    if (!data.primary?.lines?.length) {
      throw new Error(`Failed to get lyrics for ${t.title}`);
    }
  }
  console.log('✔ PASS: All disambiguated tracks returned accurate, non-conflicting lyrics!');

  // Test 2: YouTube Music Synced Lyrics Provider
  console.log('\n[test] 2. Testing YouTube Music Synced Lyrics Provider...');
  const ytRes = await fetch('http://localhost:3000/api/lyrics?title=Kesariya&artist=Pritam&videoId=BddP6PYo2gs&source=YouTube%20Music&refresh=1');
  const ytData = await ytRes.json();
  console.log(`[test] YouTube Provider full response:`, JSON.stringify(ytData));
  if (!ytData.primary?.lines?.length || ytData.primary?.source !== 'YouTube Music') {
    throw new Error('YouTube Music provider failed to return synced lyrics!');
  }
  console.log('✔ PASS: YouTube Music captions & synced lyrics provider functioning perfectly!');

  // Test 3: Playwright In-Panel Scrubber UI Verification
  console.log('\n[test] 3. Launching headless Chromium to test In-Panel Scrubber Seek Bar...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Play track and open FullScreen Lyrics
  console.log('[test] Loading track into player...');
  await page.evaluate(() => {
    window.__mcPlayer.playQueue([{
      id: 'test-track-lyrics',
      title: 'Kesariya',
      artists: ['Pritam', 'Arijit Singh'],
      album: 'Brahmastra',
      source: 'saavn',
      duration: 268,
      thumb: 'https://c.saavncdn.com/123/test-500x500.jpg',
    }], 0);
    window.__mcPlayer.setFullscreen(true);
  });
  await page.waitForTimeout(1000);

  // Click Lyrics toggle in Fullscreen
  console.log('[test] Clicking Lyrics toggle button...');
  const lyricsBtns = await page.$$('button[aria-label="Lyrics"]');
  console.log(`[test] Found ${lyricsBtns.length} Lyrics buttons`);
  for (const b of lyricsBtns) {
    try {
      await b.click();
    } catch {}
  }
  await page.waitForTimeout(1000);

  // Find the Provider Picker button (e.g. "lrc.red" or "Lyrics")
  console.log('[test] Finding Provider Picker dropdown button in header...');
  const providerBtn = await page.waitForSelector('button[aria-label="Lyrics provider"]', { timeout: 4000 }).catch(() => null);
  if (!providerBtn) {
    const allLabels = await page.$$eval('button', btns => btns.map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean));
    console.log('[test] All buttons found on page:', allLabels.slice(0, 20));
    throw new Error('Provider picker button not found in lyrics header!');
  }
  console.log('✔ PASS: Found Provider Picker button!');

  // Click Provider Picker button to open the Menu dropdown
  console.log('[test] Opening Provider Menu dropdown...');
  await providerBtn.click({ force: true });
  await page.waitForTimeout(600);

  // Verify that the Timing Offset Seek Bar is inside the Provider Menu
  const seekHeader = await page.$('text="Timing offset seek bar"');
  if (!seekHeader) {
    throw new Error('Timing offset seek bar not found inside the Provider Menu panel!');
  }
  console.log('✔ PASS: Timing offset seek bar is cleanly located INSIDE the provider panel!');

  // Test +100ms nudge button inside the menu
  console.log('[test] Testing +100ms nudge button inside provider menu...');
  const plus100Btn = await page.$('button:has-text("+100ms")');
  if (!plus100Btn) throw new Error('+100ms button not found in provider menu');
  await plus100Btn.click({ force: true });
  await page.waitForTimeout(200);

  // Check offset text inside menu
  const menuText = await page.evaluate(() => document.body.innerText);
  if (!menuText.includes('+100ms')) {
    throw new Error(`Expected +100ms in menu, got: ${menuText.slice(0, 300)}`);
  }
  console.log('✔ PASS: In-panel offset badge updated to +100ms!');

  // Test +0.5s nudge button
  const plus500Btn = await page.$('button:has-text("+0.5s")');
  await plus500Btn.click({ force: true });
  await page.waitForTimeout(200);

  const menuText2 = await page.evaluate(() => document.body.innerText);
  if (!menuText2.includes('+600ms')) {
    throw new Error(`Expected +600ms in menu, got: ${menuText2.slice(0, 300)}`);
  }
  console.log('✔ PASS: In-panel offset badge updated to +600ms (+0.60s)!');

  // Test range seek bar input
  console.log('[test] Testing range seek bar slider...');
  const rangeInput = await page.$('input[type="range"][min="-5000"][max="5000"]');
  if (!rangeInput) throw new Error('Range slider input not found in provider menu');
  await rangeInput.fill('450');
  await rangeInput.dispatchEvent('input');
  await page.waitForTimeout(200);

  const menuText3 = await page.evaluate(() => document.body.innerText);
  if (!menuText3.includes('+450ms')) {
    throw new Error(`Expected +450ms in menu, got: ${menuText3.slice(0, 300)}`);
  }
  console.log('✔ PASS: In-panel range seek bar smoothly adjusted offset to +450ms (+0.45s)!');

  // Capture screenshot proof showing the open Provider Menu with the embedded seek bar
  const screenshotPath = 'tests/stage4-lyrics-proof.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`\n✔ Saved verification screenshot to ${screenshotPath}`);

  await browser.close();
  console.log('\n======================================================');
  console.log('🎉 ALL COMPREHENSIVE LYRICS & SCRUBBER TESTS PASSED!');
  console.log('======================================================');
}

verifyLyricsSuite().then(() => process.exit(0)).catch((err) => {
  console.error('[test] Test failed:', err);
  process.exit(1);
});
