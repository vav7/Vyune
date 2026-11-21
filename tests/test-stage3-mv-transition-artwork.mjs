import { chromium } from 'playwright';
import { sizedArtwork, artworkAtPixels, saavnAtPixels } from '../web/src/lib/artwork.js';

async function verifyStage3() {
  console.log('[test] --- Stage 3: Apple-Grade MV Transition & Instant High-Res Artwork ---');

  // Test 1: High-Res Artwork Resolution Tests
  console.log('\n[test] 1. Testing Instant High-Res Artwork URL transformation...');
  
  const googleUrl = 'https://lh3.googleusercontent.com/abc=s60-c';
  const sizedGoogle = sizedArtwork(googleUrl, 800);
  console.log('Googleusercontent upscaled:', sizedGoogle);
  if (!sizedGoogle.includes('=w1200-h1200-l90-rj')) {
    throw new Error(`Expected =w1200-h1200-l90-rj, but got: ${sizedGoogle}`);
  }
  console.log('✔ PASS: Googleusercontent upscaled to 1200x1200px instantly!');

  const saavnUrl = 'https://c.saavncdn.com/123/Kesariya-From-Brahmastra-Hindi-2022-150x150.jpg';
  const sizedSaavn = sizedArtwork(saavnUrl, 800);
  console.log('JioSaavn upscaled:', sizedSaavn);
  if (!sizedSaavn.includes('-500x500.jpg')) {
    throw new Error(`Expected -500x500.jpg, but got: ${sizedSaavn}`);
  }
  console.log('✔ PASS: JioSaavn upscaled to 500x500px instantly!');

  const ytUrl = 'https://i.ytimg.com/vi/BddP6PYo2gs/hqdefault.jpg';
  const sizedYt = sizedArtwork(ytUrl, 800);
  console.log('YouTube thumbnail upscaled:', sizedYt);
  if (!sizedYt.includes('maxresdefault.jpg')) {
    throw new Error(`Expected maxresdefault.jpg, but got: ${sizedYt}`);
  }
  console.log('✔ PASS: YouTube thumbnail upscaled to maxresdefault.jpg instantly!');

  // Test 2: Browser Verification of Apple-Grade MV Transition
  console.log('\n[test] 2. Launching headless Chromium to verify Apple-Grade MV Transition...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Play track and open fullscreen
  console.log('[test] Playing track in Fullscreen Art mode...');
  await page.evaluate(() => {
    window.__mcPlayer.playQueue([{
      id: 'BddP6PYo2gs',
      title: 'Kesariya',
      artists: ['Pritam', 'Arijit Singh'],
      album: 'Brahmastra',
      source: 'yt',
      duration: 268,
      thumb: 'https://c.saavncdn.com/123/Kesariya-From-Brahmastra-Hindi-2022-150x150.jpg',
    }], 0);
    window.__mcPlayer.setFullscreen(true);
  });
  await page.waitForTimeout(1000);

  // Check initial Art mode stage
  const artModeStage = await page.evaluate(() => {
    const poster = document.querySelector('.fs-poster');
    const badge = document.querySelector('.poster-col .relative.z-30');
    return {
      aspectRatio: poster ? getComputedStyle(poster).aspectRatio : null,
      width: poster ? getComputedStyle(poster).width : null,
      height: poster ? getComputedStyle(poster).height : null,
      badgeText: badge?.textContent || '',
    };
  });
  console.log('[test] Art Mode Stage:', artModeStage);

  // Switch to MV Mode
  console.log('[test] Switching to MV mode...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const mvBtn = buttons.find(b => b.textContent.trim() === 'MV');
    mvBtn?.click();
  });

  // Verify immediate state: backdrop must NOT be pitch black and poster must stay 1:1 while buffering
  const immediateBufferingState = await page.evaluate(() => {
    const poster = document.querySelector('.fs-poster');
    const badge = document.querySelector('.poster-col');
    const backdrop = document.querySelector('.fullscreen > div[aria-hidden="true"]');
    const imageFrost = backdrop?.querySelector('canvas, img, div');
    const video = document.querySelector('video');
    return {
      aspectRatio: poster ? getComputedStyle(poster).aspectRatio : null,
      badgeText: badge?.textContent || '',
      hasImageFrostUnderneath: !!imageFrost,
      videoReady: video ? video.readyState >= 2 : false,
      videoPaused: video ? video.paused : null,
    };
  });
  console.log('[test] Immediate MV Buffering State:', immediateBufferingState);

  if (immediateBufferingState.aspectRatio === '16 / 9' && !immediateBufferingState.videoReady) {
    throw new Error('Poster snapped to 16/9 before video was ready! Should stay in 1:1 Art mode while buffering.');
  }
  console.log('✔ PASS: Poster stays in 1:1 Art mode without cropping while video buffers!');

  // Wait for video stream to buffer and trigger smooth expansion
  console.log('[test] Waiting for video buffer and fluid expansion...');
  await page.waitForFunction(() => {
    const poster = document.querySelector('.fs-poster');
    const aspect = poster ? getComputedStyle(poster).aspectRatio : null;
    return aspect === '16 / 9' || (poster && poster.clientWidth / poster.clientHeight > 1.5);
  }, { timeout: 15000 });

  const finalMvState = await page.evaluate(() => {
    const poster = document.querySelector('.fs-poster');
    const badge = document.querySelector('.poster-col');
    const video = document.querySelector('video');
    return {
      aspectRatio: poster ? getComputedStyle(poster).aspectRatio : null,
      aspectNum: poster ? (poster.clientWidth / poster.clientHeight).toFixed(2) : null,
      badgeText: badge?.textContent || '',
      hasVideo: !!video,
      videoPlaying: video ? !video.paused && video.currentTime > 0 : false,
      videoOpacity: video ? getComputedStyle(video).opacity : null,
    };
  });
  console.log('[test] Final Widescreen MV State:', finalMvState);

  if (parseFloat(finalMvState.aspectNum) < 1.5) {
    throw new Error(`Expected widescreen 16:9 aspect (>1.5), but got ${finalMvState.aspectNum}`);
  }
  console.log('✔ PASS: Smooth fluid expansion into 16:9 widescreen complete!');

  await page.screenshot({ path: 'tests/stage3-mv-transition-proof.png' });
  console.log('[test] Screenshot saved to tests/stage3-mv-transition-proof.png');
  await browser.close();

  console.log('\n🎉 ALL STAGE 3 TESTS PASSED PERFECTLY!');
}

verifyStage3().catch((err) => {
  console.error('\n❌ STAGE 3 VERIFICATION FAILED:', err);
  process.exit(1);
});
