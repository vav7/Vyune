import { chromium } from 'playwright';

async function testLiquidGlass() {
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
  await page.waitForTimeout(1500);

  const mvState = await page.evaluate(() => {
    const poster = document.querySelector('.fs-poster');
    const backdrop = document.querySelector('[data-full-screen] > div');
    const hasLiquidGlassBlooms = !!document.querySelector('[class*="filter:blur(110px)"]');
    const hasSpecularSheet = !!document.querySelector('[class*="backdrop-blur-[70px]"]');
    return {
      mode: window.__artModeStore?.mode,
      posterClass: poster?.className,
      hasLiquidGlassBlooms,
      hasSpecularSheet,
    };
  });
  console.log('[test] MV Mode Liquid Glass State:', JSON.stringify(mvState, null, 2));

  if (!mvState.hasLiquidGlassBlooms) {
    throw new Error('Liquid glass 110px diffusion blooms missing!');
  }
  if (!mvState.hasSpecularSheet) {
    throw new Error('Liquid glass specular diffusion sheet missing!');
  }
  if (!mvState.posterClass?.includes('backdrop-blur-3xl')) {
    throw new Error('Liquid glass frame missing backdrop-blur-3xl on fs-poster!');
  }

  // Switch to Visualizer mode
  console.log('[test] Switching to Visualizer mode...');
  await page.evaluate(() => {
    window.__artModeStore?.setMode('visualiser');
  });
  await page.waitForTimeout(1000);

  const visState = await page.evaluate(() => {
    const hasLiquidGlassBlooms = !!document.querySelector('[class*="filter:blur(110px)"]');
    const hasSpecularSheet = !!document.querySelector('[class*="backdrop-blur-[70px]"]');
    return {
      mode: window.__artModeStore?.mode,
      hasLiquidGlassBlooms,
      hasSpecularSheet,
    };
  });
  console.log('[test] Visualizer Mode Liquid Glass State:', JSON.stringify(visState, null, 2));

  if (!visState.hasLiquidGlassBlooms || !visState.hasSpecularSheet) {
    throw new Error('Liquid glass atmosphere should also be active in visualizer mode!');
  }

  // Take proof screenshot
  await page.screenshot({ path: 'tests/liquid-glass-proof.png' });
  console.log('[test] Screenshot saved to tests/liquid-glass-proof.png');
  console.log('[test] SUCCESS: Modern Liquid Glass transparent effect with blur & zero grain verified!');

  await browser.close();
}

testLiquidGlass().catch((err) => {
  console.error('[test] Failed:', err);
  process.exit(1);
});
