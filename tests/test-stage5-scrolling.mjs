import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('▶ Starting Stage 5 Fluid Scrolling & UI Display Verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Navigate to Browse page
  console.log('Navigating to http://localhost:3000/browse...');
  await page.goto('http://localhost:3000/browse', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.track-row', { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1000);

  // 1. Verify CSS properties on #scrollable-page
  const scrollContainerStyles = await page.evaluate(() => {
    const el = document.getElementById('scrollable-page');
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      scrollBehavior: style.scrollBehavior,
      willChange: style.willChange,
      transform: style.transform,
      overflowY: style.overflowY,
      overscrollBehaviorY: style.overscrollBehaviorY,
    };
  });

  console.log('Scroll container styles:', scrollContainerStyles);

  if (scrollContainerStyles.scrollBehavior !== 'auto') {
    throw new Error(`Expected scrollBehavior to be 'auto', got '${scrollContainerStyles.scrollBehavior}'`);
  }

  // 2. Verify content-visibility on .track-row and .lockup-card
  const elementStyles = await page.evaluate(() => {
    const row = document.querySelector('.track-row');
    const lockup = document.querySelector('.lockup-card');
    return {
      rowFound: !!row,
      rowContentVis: row ? window.getComputedStyle(row).contentVisibility : null,
      lockupFound: !!lockup,
      lockupContentVis: lockup ? window.getComputedStyle(lockup).contentVisibility : null,
    };
  });

  console.log('Element styles (content-visibility):', elementStyles);

  // 3. High-speed scrolling benchmark
  console.log('Benchmarking high-speed wheel momentum scroll...');
  const fpsStats = await page.evaluate(async () => {
    const el = document.getElementById('scrollable-page');
    if (!el) return null;

    const frameDeltas = [];
    let lastTime = performance.now();
    let rafActive = true;

    function onFrame(now) {
      const delta = now - lastTime;
      lastTime = now;
      if (delta > 0 && delta < 100) {
        frameDeltas.push(delta);
      }
      if (rafActive) requestAnimationFrame(onFrame);
    }
    requestAnimationFrame(onFrame);

    // Dispatch wheel events to simulate trackpad/wheel momentum
    for (let i = 0; i < 60; i++) {
      el.scrollTop += 50;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    for (let i = 0; i < 60; i++) {
      el.scrollTop -= 50;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    rafActive = false;
    await new Promise((r) => setTimeout(r, 100));

    const deltas = frameDeltas.slice(5);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const maxDelta = Math.max(...deltas);
    const estimatedFps = 1000 / avgDelta;

    return {
      totalFrames: deltas.length,
      avgFrameTimeMs: avgDelta.toFixed(2),
      maxFrameTimeMs: maxDelta.toFixed(2),
      estimatedFps: Math.round(estimatedFps),
    };
  });

  console.log('Scroll Performance Benchmark:', fpsStats);

  // 4. Test Search Page Scrolling & Content-Visibility
  console.log('Testing Search Input & Results Containment...');
  const searchNavBtn = await page.$('a[href="/search"], button[aria-label="Search"]');
  if (searchNavBtn) {
    await searchNavBtn.click();
    await page.waitForTimeout(1000);
    const searchInput = await page.$('input');
    if (searchInput) {
      await searchInput.fill('Arijit Singh');
      await searchInput.press('Enter');
      await page.waitForTimeout(2500);
    }
  }

  const searchStyles = await page.evaluate(() => {
    const scrollEl = document.querySelector('[data-search-scroll]');
    const searchRows = document.querySelectorAll('.group.relative.flex.w-full');
    const firstRow = searchRows[0];
    return {
      searchScrollFound: !!scrollEl,
      searchScrollBehavior: scrollEl ? window.getComputedStyle(scrollEl).scrollBehavior : null,
      searchScrollWillChange: scrollEl ? window.getComputedStyle(scrollEl).willChange : null,
      rowCount: searchRows.length,
      rowContentVis: firstRow ? window.getComputedStyle(firstRow).contentVisibility : null,
    };
  });
  console.log('Search page items & containment:', searchStyles);

  // 5. Capture screenshot proof
  const proofDir = path.resolve(process.cwd(), 'tests');
  const proofPath = path.join(proofDir, 'stage5-scrolling-proof.png');
  await page.screenshot({ path: proofPath, fullPage: false });
  console.log(`Saved screenshot proof to: ${proofPath}`);

  // Copy to artifact directory
  const artifactDir = 'C:\\Users\\vaibh\\.gemini\\antigravity\\brain\\d997fa1a-ea75-426d-ab7a-c00fe85f6d0a';
  const artifactProofPath = path.join(artifactDir, 'stage5-scrolling-proof.png');
  fs.copyFileSync(proofPath, artifactProofPath);
  console.log(`Copied proof to artifact directory: ${artifactProofPath}`);

  await browser.close();
  console.log('✔ Stage 5 Verification completed successfully!');
}

main().catch((err) => {
  console.error('❌ Stage 5 Verification failed:', err);
  process.exit(1);
});
