/**
 * static.js — the built frontend, served by the API server.
 *
 * Bun-native first: `Bun.file()` reads the asset and streams it, with no
 * Node stream shim in the way. The Node path exists only so the project can
 * still be started with `node server/index.js` on a machine without Bun.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const isBun = typeof Bun !== 'undefined';

/**
 * Only a file whose NAME carries its content hash may be cached for a year: `main-ab12cd34ef.js`, `app-….css`,
 * a chunk, a hashed asset. Fonts never change under a given name either. Everything else (index.html, sw.js,
 * the manifest, icons) is revalidated on every load, so a deploy is visible immediately and nothing goes stale.
 */
const HASHED = /[/\\]assets[/\\](?:.+[-.][a-z0-9]{8,}\.[a-z0-9]+|fonts[/\\].+)$/i;
const cacheControl = (target) => (HASHED.test(target) ? 'public, max-age=31536000, immutable' : 'no-cache');

/** A readable body for a file on disk, as a web stream. */
async function fileBody(target) {
  if (isBun) {
    const file = Bun.file(target);
    if (!(await file.exists())) return null;
    return file.stream();
  }
  const { createReadStream } = await import('node:fs');
  const { Readable } = await import('node:stream');
  return Readable.toWeb(createReadStream(target));
}

async function statFile(target) {
  try {
    const info = await stat(target);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

/**
 * Serve the files under `root`. A miss falls through to the next handler, so
 * the SPA fallback can answer it.
 */
export function serveStatic(root) {
  const rootAbs = path.resolve(root);
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return next();
    }
    if (pathname.includes('\0')) return next();

    const target = path.resolve(rootAbs, pathname.replace(/^\/+/, ''));
    // Never step outside the build directory.
    if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) return next();

    const info = await statFile(target);
    if (!info) return next();

    // A pre-built brotli twin (made by the build) is sent as-is when the browser accepts it.
    let sendPath = target;
    let sendSize = info.size;
    let encoding = null;
    if (/\bbr\b/.test(c.req.header('accept-encoding') || '') && /\.(js|css|html|svg|json|webmanifest|txt)$/.test(target)) {
      const twin = await statFile(`${target}.br`);
      if (twin) {
        sendPath = `${target}.br`;
        sendSize = twin.size;
        encoding = 'br';
      }
    }
    const headers = {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(sendSize),
      Vary: 'Accept-Encoding',
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
      'Cache-Control': cacheControl(target),
    };

    if (c.req.method === 'HEAD') return new Response(null, { headers });

    const body = await fileBody(sendPath);
    if (!body) return next();
    return new Response(body, { headers });
  };
}

/** The client-side-router fallback: every unknown path is the app's index.html. */
export function spaFallback(root, index = 'index.html') {
  const file = path.join(path.resolve(root), index);
  return async (c) => {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
    if (c.req.method === 'HEAD') return new Response(null, { headers });
    let sendPath = file;
    if (/\bbr\b/.test(c.req.header('accept-encoding') || '') && (await statFile(`${file}.br`))) {
      sendPath = `${file}.br`;
      headers['Content-Encoding'] = 'br';
      headers.Vary = 'Accept-Encoding';
    }
    const body = await fileBody(sendPath);
    if (!body) return c.text('Frontend build not found. Run: bun run build', 500);
    return new Response(body, { headers });
  };
}
