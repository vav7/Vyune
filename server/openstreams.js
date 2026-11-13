/**
 * Open-source YouTube front-ends as a stream fallback: Piped and Invidious.
 *
 * Both are community projects that resolve a video's audio formats over a
 * plain JSON API, from servers whose IP is not the listener's. They sit
 * between YouTube's own clients and yt-dlp in the route order. Public
 * instances come and go, so the list is overridable:
 *   PIPED_INSTANCES=https://a.example,https://b.example
 *   INVIDIOUS_INSTANCES=https://c.example
 * A dead instance is skipped for ten minutes.
 */
const PIPED = (process.env.PIPED_INSTANCES || 'https://pipedapi.kavin.rocks,https://pipedapi.adminforge.de,https://api.piped.private.coffee').split(',').map((s) => s.trim()).filter(Boolean);
const INVIDIOUS = (process.env.INVIDIOUS_INSTANCES || 'https://yewtu.be,https://inv.nadeko.net').split(',').map((s) => s.trim()).filter(Boolean);
const dead = new Map();

async function getJson(url, ms = 4500) {
  const host = new URL(url).origin;
  if ((dead.get(host) || 0) > Date.now()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(String(resp.status));
    return await resp.json();
  } catch {
    dead.set(host, Date.now() + 10 * 60_000);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const best = (formats) =>
  formats
    .filter((f) => f.url && /^https?:\/\//.test(f.url) && /audio/i.test(f.mime || ''))
    // AAC in an mp4 container plays everywhere; prefer it, then the highest bitrate.
    .sort((a, b) => (/mp4/i.test(b.mime) - /mp4/i.test(a.mime)) || (b.bitrate || 0) - (a.bitrate || 0))[0];

async function viaPiped(base, id) {
  const data = await getJson(`${base}/streams/${id}`);
  const streams = (data?.audioStreams || []).map((s) => ({ url: s.url, mime: s.mimeType, bitrate: s.bitrate, contentLength: s.contentLength }));
  return best(streams) || null;
}

async function viaInvidious(base, id) {
  const data = await getJson(`${base}/api/v1/videos/${id}?fields=adaptiveFormats`);
  const streams = (data?.adaptiveFormats || []).map((f) => ({
    url: f.url,
    mime: String(f.type || '').split(';')[0],
    bitrate: Number(f.bitrate) || 0,
    contentLength: Number(f.clen) || undefined,
  }));
  return best(streams) || null;
}

/** First instance to answer wins; every instance is asked at once. */
export async function openStream(videoId) {
  const attempts = [
    ...PIPED.map((base) => viaPiped(base, videoId)),
    ...INVIDIOUS.map((base) => viaInvidious(base, videoId)),
  ].map((p) => p.then((hit) => hit || Promise.reject(new Error('none'))));
  try {
    const hit = await Promise.any(attempts);
    return { url: hit.url, mime: hit.mime || 'audio/mp4', bitrate: hit.bitrate, contentLength: hit.contentLength };
  } catch {
    return null;
  }
}
