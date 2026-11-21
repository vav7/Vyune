import { Ytdl, chooseFormat } from '@distube/ytdl-core';
import { Readable } from 'node:stream';

const ytdl = new Ytdl();
const videoFormatCache = new Map();

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
    const info = await ytdl.getInfo(url);
    const videoFormats = info.formats.filter(
      (f) => f.hasVideo && (f.container === 'mp4' || f.container === 'webm')
    );

    // Filter out >1080p formats (e.g. 4K/8K re-uploads) to avoid severe decoding lag
    const max1080p = videoFormats.filter((f) => !f.height || f.height <= 1080);
    const candidates = max1080p.length > 0 ? max1080p : videoFormats;

    // Prefer MP4 1080p -> 720p -> 480p for hardware decoding
    const chosen =
      candidates.find((f) => f.container === 'mp4' && f.height === 1080) ||
      candidates.find((f) => f.height === 1080) ||
      candidates.find((f) => f.container === 'mp4' && f.height === 720) ||
      candidates.find((f) => f.height === 720) ||
      candidates.find((f) => f.height && f.height <= 1080) ||
      candidates[0];

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
