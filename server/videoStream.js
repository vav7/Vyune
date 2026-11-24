import { Ytdl, createPoTokenProvider, chooseFormat } from '@distube/ytdl-core';
import { Readable } from 'node:stream';

let ytdlPromise = null;
export async function getYtdl() {
  if (!ytdlPromise) {
    ytdlPromise = (async () => {
      try {
        const getPoToken = await createPoTokenProvider();
        return new Ytdl({ getPoToken });
      } catch (err) {
        console.warn('[videoStream] createPoTokenProvider fallback to default:', err?.message || err);
        return new Ytdl();
      }
    })();
  }
  return ytdlPromise;
}

const videoFormatCache = new Map();

/**
 * Resolves pristine audio stream using local PO-token provider to bypass bot challenges.
 */
export async function resolveDistubeAudioStream(videoId, preferOpus = false) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const ytdl = await getYtdl();
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const audioFormats = (info.formats || []).filter((f) => f.hasAudio && !f.hasVideo);
    if (!audioFormats.length) return null;

    let chosen = null;
    if (preferOpus) {
      chosen = audioFormats
        .filter((f) => /webm|opus/i.test(f.container || f.mimeType || ''))
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    }
    if (!chosen) {
      chosen = audioFormats
        .filter((f) => /mp4|aac|m4a/i.test(f.container || f.mimeType || ''))
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    }
    if (!chosen) {
      chosen = audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    }
    if (!chosen?.url) return null;

    return {
      url: chosen.url,
      mime: chosen.mimeType?.split(';')[0] || (chosen.container === 'mp4' ? 'audio/mp4' : 'audio/webm'),
      bitrate: (chosen.audioBitrate || 128) * 1000,
      contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
      client: 'YTDL_PO',
    };
  } catch (err) {
    console.warn(`[videoStream] audio stream resolution failed for ${videoId}:`, err?.message || err);
    return null;
  }
}

/**
 * Streams 1080p/720p hardware-accelerated YouTube music video with full RFC 7233 range support.
 * Uses chunked downloading (1MB chunks) to completely bypass YouTube's 12MB bandwidth/rate-limit ceiling.
 * Immediately tears down abandoned Range requests via client AbortSignal to prevent socket starvation and stuttering.
 */
export async function proxyVideoStream(videoId, rangeHeader, method = 'GET', signal) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ error: 'invalid_video_id' }), { status: 400 });
  }

  if (signal?.aborted) {
    return new Response(null, { status: 499 });
  }

  const now = Date.now();
  let cached = videoFormatCache.get(videoId);

  if (!cached || now > cached.expiresAt) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const ytdl = await getYtdl();
    const info = await ytdl.getInfo(url);
    const videoFormats = info.formats.filter(
      (f) => f.hasVideo && (f.container === 'mp4' || f.container === 'webm')
    );

    // Cap at 1080p H.264 (avc1) for universal hardware GPU decode and instant seeking.
    // 4K 2160p progressive MP4 streams force massive keyframe downloads and decoder flushes,
    // whereas 1080p H.264 starts in <150ms, uses 4-6x less bandwidth, and decodes smoothly on all GPUs.
    const isAv1 = (f) => /av01/i.test(f.codecs || f.mimeType || '');
    const hasGoodNonAv1 = videoFormats.some((f) => !isAv1(f) && (f.height || 0) >= 480);
    const nonAv1 = hasGoodNonAv1 ? videoFormats.filter((f) => !isAv1(f)) : videoFormats;

    const hdCandidates = nonAv1.filter((f) => (f.height || 0) <= 1080 && (f.height || 0) >= 480);
    const candidates = hdCandidates.length > 0 ? hdCandidates : nonAv1;

    const sorted = [...candidates].sort((a, b) => {
      // 1. Prefer AVC1 / H.264 for hardware GPU decode
      const isAvc1A = /avc1|h264/i.test(a.codecs || a.container || a.mimeType || '');
      const isAvc1B = /avc1|h264/i.test(b.codecs || b.container || b.mimeType || '');
      if (isAvc1A !== isAvc1B) return isAvc1A ? -1 : 1;

      // 2. Highest resolution capped at 1080p (1080p -> 720p -> 480p)
      const hA = Math.min(a.height || 0, 1080);
      const hB = Math.min(b.height || 0, 1080);
      if (hA !== hB) return hB - hA;

      // 3. Prefer MP4 container
      const isMp4A = /mp4/i.test(a.container || a.mimeType || '');
      const isMp4B = /mp4/i.test(b.container || b.mimeType || '');
      if (isMp4A !== isMp4B) return isMp4A ? -1 : 1;

      return (b.bitrate || 0) - (a.bitrate || 0);
    });

    const chosen = sorted[0];

    if (!chosen) {
      return new Response(JSON.stringify({ error: 'no_video_format' }), { status: 404 });
    }

    cached = {
      info,
      format: chosen,
      expiresAt: now + 3 * 3600_000,
    };
    videoFormatCache.set(videoId, cached);
  }

  const format = cached.format;
  const mimeType = format.mimeType?.split(';')[0] || (format.container === 'mp4' ? 'video/mp4' : 'video/webm');
  const total = format.contentLength ? parseInt(format.contentLength, 10) : 0;

  let start = 0;
  let end = total > 0 ? total - 1 : undefined;
  let isRange = false;

  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    isRange = true;
    const parts = rangeHeader.replace('bytes=', '').split('-');
    start = parseInt(parts[0], 10) || 0;
    if (parts[1]) {
      end = parseInt(parts[1], 10);
    }
  }

  const resHeaders = new Headers();
  resHeaders.set('Content-Type', mimeType);
  resHeaders.set('Content-Disposition', 'inline');
  resHeaders.set('Accept-Ranges', 'bytes');
  resHeaders.set('Cache-Control', 'public, max-age=7200');
  resHeaders.set('Access-Control-Allow-Origin', '*');
  resHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  resHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Range, Accept-Ranges, Content-Type');
  resHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

  const actualEnd = end !== undefined ? end : (total > 0 ? total - 1 : undefined);
  if (isRange && actualEnd !== undefined) {
    resHeaders.set('Content-Range', `bytes ${start}-${actualEnd}/${total || '*'}`);
    resHeaders.set('Content-Length', String(actualEnd - start + 1));
  } else if (total > 0) {
    resHeaders.set('Content-Length', String(total));
  }

  if (method === 'HEAD') {
    return new Response(null, {
      status: isRange ? 206 : 200,
      headers: resHeaders,
    });
  }

  if (format.url) {
    try {
      const streamUrl = new URL(format.url);
      const streamClient = (streamUrl.searchParams.get('c') || '').toUpperCase();
      const clientIds = {
        VISIONOS: '82',
        ANDROID_VR: '28',
        TV_EMBEDDED: '85',
        IOS: '5',
        ANDROID: '3',
        WEB: '1',
        WEB_REMIX: '67',
      };
      const clientUAs = {
        VISIONOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        ANDROID_VR: 'Mozilla/5.0 (Linux; Android 12; Quest 3 Build/SQ3A.220605.009.A1) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.35.53.585721111 SamsungBrowser/4.0 Chrome/122.0.6261.119 Mobile VR Safari/537.36',
        TV_EMBEDDED: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 NativeClient-FreeBSD Safari/538.1',
        IOS: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X; en_US)',
        ANDROID: 'com.google.android.youtube/19.45.36 (Linux; U; Android 14; en_US) gzip',
      };

      const upHeaders = {
        'User-Agent': clientUAs[streamClient] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      };
      if (clientIds[streamClient]) {
        upHeaders['X-YouTube-Client-Name'] = clientIds[streamClient];
      }
      const isWebClient = streamClient === 'WEB' || streamClient === 'MWEB' || streamClient === 'WEB_REMIX';
      if (isWebClient) {
        upHeaders.Origin = 'https://www.youtube.com';
        upHeaders.Referer = 'https://www.youtube.com/';
        upHeaders['X-Origin'] = 'https://www.youtube.com';
      }

      if (isRange && actualEnd !== undefined) {
        upHeaders.Range = `bytes=${start}-${actualEnd}`;
      } else if (isRange) {
        upHeaders.Range = `bytes=${start}-`;
      }
      const up = await fetch(format.url, { headers: upHeaders, signal });
      if (up.ok || up.status === 206) {
        if (up.headers.has('content-range')) {
          resHeaders.set('Content-Range', up.headers.get('content-range'));
        }
        if (up.headers.has('content-length')) {
          resHeaders.set('Content-Length', up.headers.get('content-length'));
        }
        return new Response(up.body, {
          status: isRange ? 206 : 200,
          headers: resHeaders,
        });
      }
    } catch (e) {
      // Fall through to ytdl.download
    }
  }

  const rangeOpt = isRange && actualEnd !== undefined ? { start, end: actualEnd } : (isRange ? { start } : undefined);

  try {
    const nodeStream = await ytdl.download(cached.info, {
      format,
      range: rangeOpt,
      dlChunkSize: 1024 * 1024,
    });

    let destroyed = false;
    const cleanup = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        if (!nodeStream.destroyed) {
          nodeStream.destroy();
        }
      } catch {}
    };

    if (signal) {
      signal.addEventListener('abort', cleanup, { once: true });
    }
    nodeStream.on('close', cleanup);
    nodeStream.on('end', cleanup);
    nodeStream.on('error', cleanup);

    const webStream = Readable.toWeb(nodeStream);

    return new Response(webStream, {
      status: isRange ? 206 : 200,
      headers: resHeaders,
    });
  } catch (err) {
    console.error(`[videoStream] download failed for ${videoId}:`, err?.message || err);
    videoFormatCache.delete(videoId);
    return new Response(JSON.stringify({ error: 'stream_download_failed' }), { status: 502 });
  }
}
