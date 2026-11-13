/**
 * The last resort when no stream can be resolved: YouTube's own IFrame player,
 * hidden, used for its audio only. Nothing of it is ever visible.
 *
 * The app plays through one shared <audio> element that the scrubber, the
 * media keys and the lyrics all read. While this fallback is engaged, that
 * element's time, duration, volume and play state are answered by the iframe
 * player and its events are re-emitted, so every consumer keeps working
 * unchanged. Releasing it restores the element's own behaviour.
 */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(volume: number): void;
  getPlayerState(): number;
  destroy(): void;
  getVideoData?(): { video_id?: string };
}
interface YTNamespace {
  Player: new (el: HTMLElement, options: unknown) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
}

let apiReady: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  apiReady ??= new Promise<YTNamespace>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      fn();
    };
    const timeout = window.setTimeout(
      () => finish(() => {
        apiReady = null;
        reject(new Error('YouTube iframe API timed out'));
      }),
      10000,
    );
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (w.YT?.Player) finish(() => resolve(w.YT!));
    };
    // The script can already be on the page from an earlier attempt: reuse it
    // (a second tag would never call the ready hook again) and poll for YT.
    const existing = document.querySelector<HTMLScriptElement>('script[data-yt-iframe-api]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ytIframeApi = '1';
      script.onerror = () => finish(() => {
        script.remove();
        apiReady = null;
        reject(new Error('YouTube iframe API unavailable'));
      });
      document.head.appendChild(script);
    }
    const poll = window.setInterval(() => {
      if (w.YT?.Player) {
        window.clearInterval(poll);
        finish(() => resolve(w.YT!));
      } else if (settled) window.clearInterval(poll);
    }, 150);
  });
  return apiReady;
}

let active: { destroy: () => void } | null = null;

export function releaseIframeFallback() {
  active?.destroy();
  active = null;
}

export async function engageIframeFallback(audio: HTMLAudioElement, videoId: string, volume: number): Promise<void> {
  releaseIframeFallback();
  const YT = await loadApi();
  // The element's own stream is the thing that failed: stop it so it cannot fight the iframe.
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch {
    // nothing to stop
  }
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // YouTube refuses to play an embed smaller than 200x200, so it is parked off-screen at a legal size.
  host.style.cssText = 'position:fixed;left:-480px;bottom:0;width:240px;height:240px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:-1';
  const mount = document.createElement('div');
  host.appendChild(mount);
  document.body.appendChild(host);

  let state = -1;
  let level = volume;
  const emit = (name: string) => audio.dispatchEvent(new Event(name));

  const player = await new Promise<YTPlayer>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('iframe player timed out')), 12000);
    const created = new YT.Player(mount, {
      videoId,
      width: 240,
      height: 240,
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        fs: 0,
        rel: 0,
        modestbranding: 1,
        enablejsapi: 1,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          window.clearTimeout(timer);
          try {
            created.playVideo();
          } catch {
            // the caller's play() retries
          }
          resolve(created);
        },
        onAutoplayBlocked: () => {
          // Reported as a pause so the transport shows Play; pressing it calls playVideo() inside a user gesture.
          emit('pause');
        },
        onError: (event: { data?: number }) => {
          window.clearTimeout(timer);
          reject(new Error(`iframe player refused this video (${event?.data ?? 'unknown'})`));
        },
        onStateChange: (event: { data: number }) => {
          state = event.data;
          if (state === YT.PlayerState.PLAYING) {
            emit('loadedmetadata');
            emit('durationchange');
            emit('play');
            emit('playing');
          } else if (state === YT.PlayerState.PAUSED) emit('pause');
          else if (state === YT.PlayerState.ENDED) emit('ended');
        },
      },
    });
  }).catch((error) => {
    host.remove();
    throw error;
  });

  const original = {
    play: audio.play.bind(audio),
    pause: audio.pause.bind(audio),
  };
  const define = (name: string, descriptor: PropertyDescriptor) =>
    Object.defineProperty(audio, name, { configurable: true, ...descriptor });
  // The element has no src of its own any more; report the video's, so "is something loaded?" checks (seek, play/pause) stay true.
  define('src', { get: () => `https://www.youtube.com/watch?v=${videoId}`, set: () => undefined });
  define('currentTime', { get: () => player.getCurrentTime() || 0, set: (value: number) => player.seekTo(value, true) });
  define('duration', { get: () => player.getDuration() || NaN });
  define('paused', { get: () => state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING });
  define('ended', { get: () => state === YT.PlayerState.ENDED });
  define('error', { get: () => null });
  define('volume', { get: () => level, set: (value: number) => { level = value; player.setVolume(Math.round(value * 100)); } });
  define('play', { value: async () => player.playVideo() });
  define('pause', { value: () => player.pauseVideo() });
  player.setVolume(Math.round(level * 100));

  const tick = window.setInterval(() => {
    if (state === YT.PlayerState.PLAYING) emit('timeupdate');
  }, 250);

  active = {
    destroy: () => {
      window.clearInterval(tick);
      try {
        player.destroy();
      } catch {
        // already gone
      }
      host.remove();
      for (const name of ['src', 'currentTime', 'duration', 'paused', 'ended', 'error', 'volume', 'play', 'pause']) {
        delete (audio as unknown as Record<string, unknown>)[name];
      }
      void original;
    },
  };
}
