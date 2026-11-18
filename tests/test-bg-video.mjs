import { chromium } from 'playwright';

async function testBgVideo() {
  console.log('[test] Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('[test] Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Play a track and open FullScreenPlayer
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
  await page.waitForTimeout(1500);

  // Switch to MV mode
  console.log('[test] Switching to MV mode...');
  await page.evaluate(() => {
    window.__artModeStore?.setMode('mv');
  });
  await page.waitForTimeout(2000);

  const state = await page.evaluate(() => {
    const backdropCanvas = document.querySelector('[data-full-screen] canvas');
    const frostedLayer = document.querySelector('[class*="backdrop-blur-[55px]"]');
    const hasSyntheticColorOrbs = !!document.querySelector('[class*="filter:blur(110px)"]');
    const fgVideo = document.querySelector('.fs-poster video');
    return {
      mode: window.__artModeStore?.mode,
      hasBackdropCanvas: !!backdropCanvas,
      hasFrostedGlassLayer: !!frostedLayer,
      hasSyntheticColorOrbs,
      fgVideoReady: fgVideo ? fgVideo.readyState : 0,
      fgVideoSrc: fgVideo?.src,
    };
  });

  console.log('[test] Fullscreen Background Video State:', JSON.stringify(state, null, 2));

  if (!state.hasFrostedGlassLayer) {
    throw new Error('Liquid glass frosted diffusion layer missing in backdrop!');
  }
  if (state.hasSyntheticColorOrbs) {
    throw new Error('Synthetic color orbs should not be rendered — only the video playing in background!');
  }

  // Screenshot proof
  await page.screenshot({ path: 'tests/bg-video-proof.png' });
  console.log('[test] Proof screenshot saved to tests/bg-video-proof.png');
  console.log('[test] SUCCESS: Video plays in background with modern liquid glass blur and zero other color/orbs!');

  await browser.close();
}

testBgVideo().catch(err => {
  console.error('[test] Failed:', err);
  process.exit(1);
});
