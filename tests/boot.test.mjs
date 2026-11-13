/* The first load, as a contract: what the built page may and may not ask the browser to do. Run after `bun run build`. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '../server/static.js';

const DIST = path.resolve(import.meta.dir, '..', 'dist');
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

// 1. Nothing third-party in the critical path.
assert.ok(!/fonts\.googleapis\.com/.test(html), 'no Google Fonts stylesheet in the document');
// 2. Direct hashed stylesheet link
const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
assert.ok(sheets.length >= 1, 'stylesheet present');
// 3. Clean inline style in HTML
assert.ok(/<style>/.test(html), 'inline style present');
// 4. Every file the document references is content-hashed and exists.
const refs = [...html.matchAll(/(?:href|src)="\/assets\/([^"]+)"/g)].map((m) => m[1]).filter((f) => !f.startsWith('fonts/'));
assert.ok(refs.length >= 2);
for (const f of refs) {
  assert.ok(/-[a-z0-9]{8,}\.(js|css)$/.test(f), `unhashed asset in document: ${f}`);
  assert.ok(fs.existsSync(path.join(DIST, 'assets', f)), `missing: ${f}`);
}
// 5. Budget: the bytes needed to start, brotli-compressed.
let br = 0;
for (const f of new Set(refs)) {
  const p = path.join(DIST, 'assets', f);
  br += fs.existsSync(`${p}.br`) ? fs.statSync(`${p}.br`).size : fs.statSync(p).size;
}
assert.ok(br < 140_000, `initial payload ${br} B brotli exceeds 140 KB`);
// 6. The service worker was stamped with a build id.
assert.ok(!fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8').includes('__BUILD_ID__'), 'sw.js build id stamped');

// 7. Caching: hashed files immutable, everything else revalidated.
const app = new Hono();
app.use('*', serveStatic(DIST));
const cc = async (url) => (await app.request(url)).headers.get('cache-control');
assert.match(await cc(`/assets/${refs.find((f) => f.endsWith('.css'))}`), /immutable/);
assert.match(await cc(`/assets/${refs.find((f) => f.endsWith('.js'))}`), /immutable/);
assert.equal(await cc('/sw.js'), 'no-cache');
assert.equal(await cc('/index.html'), 'no-cache');
console.log(`boot tests passed (initial ${(br / 1024).toFixed(1)} KB brotli, ${new Set(refs).size} files)`);
