/**
 * proxy.js — CORS-proof media & image proxies.
 *
 * Why: <img>/<audio> tags don't need CORS, but Web Audio analysis (visualizer),
 * canvas work, and some browsers' strict modes do — and a few CDNs flake on
 * hotlinking. These proxies make every upstream asset same-origin:
 *
 *   GET /api/img?url=…    → cached image passthrough (7-day browser cache)
 *   GET /api/media?url=…  → Range-capable audio passthrough (seek works)
 *
 * Hard host allowlists — never an open proxy.
 */

import { UA } from './cache.js';
import { getYT } from './yt.js';

/**
 * Image hosts, as exact names and as suffixes.
 *
 * The suffix rule matters: Google's image CDN answers under a family of
 * host names — lh3, yt3, yt4, yt5, yt6 .googleusercontent.com, and the
 * .ggpht.com family. A playlist's picture comes from yt3.googleusercontent
 * and a search row's from lh3, so an exact list left half the artwork
 * unproxied — and the canvas read of an unproxied picture fails, which is
 * why the backdrop stayed flat grey for those tracks.
 *
 * Apple's is the same story: the artist hero, the title logo and the motion
 * preview come from is1-ssl through is5-ssl .mzstatic.com, so the family is
 * matched by suffix rather than listed one host at a time.
 */
const IMG_HOSTS = new Set([
  'i.ytimg.com',
  'c.saavncdn.com',
  'aac.saavncdn.com',
  'is1-ssl.mzstatic.com',
  'e-cdns-images.dzcdn.net',
  'music.youtube.com',
  'www.youtube.com',
  // The Cover Art Archive serves release art from archive.org's item hosts.
  // A sleeve chosen from MusicBrainz has to be readable by the browser, and
  // the canvas read that colours the page fails on an unproxied picture.
  'coverartarchive.org',
]);

const IMG_HOST_SUFFIX = /\.(?:googleusercontent\.com|ggpht\.com|mzstatic\.com|archive\.org)$/;

const MEDIA_HOST_RE = /(^|\.)(googlevideo\.com|saavncdn\.com|youtube\.com)$/;

/** Parse the single byte range requested by an audio element. */
function parseByteRange(value) {
  const match = String(value || '').match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  if (!Number.isSafeInteger(start) || start < 0 || (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
  return { start, end };
}

function allowed(urlStr, mode) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    if (mode === 'img') {
      return IMG_HOSTS.has(host) || IMG_HOST_SUFFIX.test(host) ? u : null;
    }
    return MEDIA_HOST_RE.test(host) ? u : null;
  } catch {
    return null;
  }
}

export function registerProxies(app) {
  /* ------------------------------- images ------------------------------- */
  app.get('/api/img', async (c) => {
    const u = allowed(String(c.req.query('url') || ''), 'img');
    if (!u) return c.json({ error: 'host not allowed' }, 403);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const up = await fetch(u, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (!up.ok || !up.body) return c.body(null, up.status || 502);
      return new Response(up.body, {
        status: 200,
        headers: {
          'Content-Type': up.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return c.body(null, 502);
    }
  });

  /* ------------------------------- media ------------------------------- */
  app.get('/api/media', async (c) => {
    return streamMedia(c, c.req.query('url'), c.req.query('size'));
  });
}

/**
 * Universal Byte-Range Media Streaming Engine.
 * Streams audio and high-definition video directly to HTML5 media elements.
 * Features:
 * - Proper byte-range slicing (HTTP 206)
 * - 'Content-Disposition: inline' to prevent download manager (IDM) interception
 * - Upstream Google Video 403 header recovery
 * - Hardware video acceleration support
 */
export async function streamMedia(c, rawUrl, declaredSize = null) {
  const u = allowed(String(rawUrl || ''), 'media');
  if (!u) return c.json({ error: 'host not allowed' }, 403);
  try {
    const isYouTube = /\.googlevideo\.com$/i.test(u.hostname);
    const isSaavn = /\.saavncdn\.com$/i.test(u.hostname);

    const sizeParam = Number(declaredSize ?? c.req.query('size'));
    const totalSize = Number.isSafeInteger(sizeParam) && sizeParam > 0 ? sizeParam : null;
    const headers = { 'User-Agent': UA };
    const finalUrl = new URL(u.href);
    const range = c.req.header('range');
    let youtubeRange = null;

    if (isYouTube) {
      const requested = parseByteRange(range);
      if (range && !requested) return c.body(null, 416);
      const start = requested?.start ?? 0;
      if (totalSize !== null && start >= totalSize) {
        c.header('Content-Range', `bytes */${totalSize}`);
        return c.body(null, 416);
      }
      youtubeRange = { start, totalSize, requested };
      const streamClient = (finalUrl.searchParams.get('c') || '').toUpperCase();
      const clientVersion = finalUrl.searchParams.get('cver');
      const clientIds = {
        WEB: '1', MWEB: '2', ANDROID: '3', IOS: '5',
        ANDROID_MUSIC: '21', ANDROID_VR: '28', WEB_REMIX: '67', VISIONOS: '82',
      };
      const session = await getYT().catch(() => null);
      headers['User-Agent'] = session?.session?.user_agent || UA;
      if (clientVersion) headers['X-YouTube-Client-Version'] = clientVersion;
      if (clientIds[streamClient]) headers['X-YouTube-Client-Name'] = clientIds[streamClient];
      if (session?.session?.context?.client?.visitorData) {
        headers['X-Goog-Visitor-Id'] = session.session.context.client.visitorData;
      }
      // Google Video request rules: only web clients need origin headers;
      // mobile/app clients (ANDROID, IOS, VISIONOS) are rejected with 403 if origin headers are sent.
      const isWebClient = streamClient === 'WEB' || streamClient === 'MWEB' || streamClient === 'WEB_REMIX';
      if (isWebClient) {
        headers.Origin = 'https://www.youtube.com';
        headers.Referer = 'https://www.youtube.com/';
        headers['X-Origin'] = 'https://www.youtube.com';
      }
      if (range) headers.Range = range;
    } else if (isSaavn && range) {
      headers.Range = range;
    }

    let up = await fetch(finalUrl.href, { headers });

    // If upstream rejects with 403/401 (e.g. Google Video header mismatch), retry immediately with clean minimal headers
    if (isYouTube && !up.ok && (up.status === 403 || up.status === 401)) {
      const cleanHeaders = { 'User-Agent': UA };
      if (range) cleanHeaders.Range = range;
      const retryUp = await fetch(finalUrl.href, { headers: cleanHeaders });
      if (retryUp.ok || retryUp.status === 206) {
        up = retryUp;
      }
    }

    // An upstream that refuses the range is answered once more without one
    if (!up.ok && up.status !== 206 && range && !isYouTube) {
      up = await fetch(u.href, { headers: { 'User-Agent': UA } });
    }
    if (!up.ok && up.status !== 206) return c.body(null, up.status || 502);
    if (isYouTube && range && up.status === 200 && youtubeRange?.start > 0) {
      return c.body(null, 502);
    }

    const defaultType = finalUrl.searchParams.get('mime') || (isYouTube && finalUrl.href.includes('mime=video') ? 'video/mp4' : 'audio/mpeg');
    const out = {
      'Content-Type': up.headers.get('content-type') || defaultType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
    };
    const len = up.headers.get('content-length');
    if (len) out['Content-Length'] = len;
    const cr = up.headers.get('content-range');
    if (cr) out['Content-Range'] = cr;
    else if (youtubeRange && up.status === 206 && youtubeRange.totalSize !== null) {
      const bodyLength = Number(len);
      const end =
        Number.isSafeInteger(bodyLength) && bodyLength > 0
          ? youtubeRange.start + bodyLength - 1
          : (youtubeRange.requested?.end ?? youtubeRange.totalSize - 1);
      out['Content-Range'] = `bytes ${youtubeRange.start}-${Math.min(end, youtubeRange.totalSize - 1)}/${youtubeRange.totalSize}`;
    }

    return new Response(up.body, { status: up.status, headers: out });
  } catch (err) {
    return c.body(null, 502);
  }
}
