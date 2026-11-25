/**
 * Apple's motion artwork is HLS. Chromium answers "maybe" to the HLS MIME type
 * and still cannot play it, so hls.js (loaded only when a clip is on screen)
 * is tried first and the native player is the fallback — Safari has no MSE for
 * hls.js to use on iPhone, and plays the stream itself.
 */
export interface ClipHandle {
  destroy: () => void;
}

export async function attachHlsClip(
  video: HTMLVideoElement,
  source: string,
  opts: { maxBufferLength?: number } = {},
): Promise<ClipHandle | null> {
  // Apple's music-video previews are plain mp4: no player library needed.
  if (!/\.m3u8(?:$|\?)/i.test(source)) {
    if (video.src !== source) {
      video.src = source;
    }
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }
  try {
    const { default: Hls } = await import('hls.js/light');
    if (Hls.isSupported()) {
      const hls = new Hls({
        capLevelToPlayerSize: true,
        maxBufferLength: opts.maxBufferLength ?? 6,
        maxMaxBufferLength: 10,
        maxBufferSize: 15 * 1024 * 1024,
        startLevel: -1,
        enableWorker: true,
      });
      hls.loadSource(source);
      hls.attachMedia(video);
      return { destroy: () => hls.destroy() };
    }
  } catch {
    // fall through to the native player
  }
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = source;
    return {
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }
  return null;
}
