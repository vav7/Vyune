import { engageIframeFallback, releaseIframeFallback } from '@/lib/iframeAudio';
import { queryClient } from '@/lib/queryClient';
import { currentTier, TIERS } from '@/lib/perf';
import { api as apiClient } from '@/lib/api';
/* player store — audio engine + queue + favorites + history (Solid store).
 *
 * Perf rule: high-frequency values (currentTime) NEVER enter the store.
 * Components subscribe via subscribeProgress() (one shared rAF) and write
 * directly to DOM refs. The store only holds discrete state.
 *
 * The store is a Solid `createStore` proxy. Read a property off the proxy
 * inside JSX (or inside a selector) and it is reactive; read it through
 * `snap()` and it is a plain snapshot — which is what identity checks need,
 * because the proxy wraps objects and `proxy !== original`.
 */

import { createStore, unwrap } from 'solid-js/store';
import { prewarmArtworkColor } from '@/lib/artworkColor';
import { isVideoThumbnail } from '@/lib/artwork';
import { getCachedArtwork, setCachedArtwork, warmTrackArtwork } from '@/lib/artworkCache';
import { persistSlice, readLS, writeLS } from './persist';
import { api } from '../lib/api';
import type { StreamResult, Track } from '../lib/types';

/* ------------------------------ audio singleton ------------------------------ */

export const audio = new Audio();
audio.preload = 'auto';

/* ------------------------------ localStorage ------------------------------ */

const LS = {
  get<T>(key: string, fallback: T): T {
    return readLS(key, fallback);
  },
  set(key: string, val: unknown) {
    writeLS(key, val);
  },
};

/* ------------------------------ progress bus ------------------------------ */

type ProgressFn = (cur: number, dur: number) => void;
const progressSubs = new Set<ProgressFn>();
let rafId = 0;

function progressLoop() {
  const dur = audio.duration || 0;
  const cur = audio.currentTime || 0;
  progressSubs.forEach((fn) => fn(cur, dur));
  rafId = requestAnimationFrame(progressLoop);
}

/** Subscribe to time updates without re-rendering the view. Returns unsub. */
export function subscribeProgress(fn: ProgressFn): () => void {
  progressSubs.add(fn);
  if (!rafId) rafId = requestAnimationFrame(progressLoop);
  return () => {
    progressSubs.delete(fn);
    if (!progressSubs.size && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

/* ------------------------------ store ------------------------------ */

export interface PlayContext {
  type: 'search' | 'album' | 'playlist' | 'artist';
  title?: string;
}

export interface PlayerState {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  shuffle: boolean;
  repeat: 0 | 1 | 2;
  volume: number;
  muted: boolean;
  favorites: Track[];
  history: Track[];
  fullscreen: boolean;
  toast: string | null;
  sleepUntil: number | null;
  /** AutoPlay: keep topping the queue up with radio when it runs dry. */
  autoDj: boolean;
  /** Where the radio top-up section starts in the queue (null = none yet). */
  autoStart: number | null;
  sourceContext: PlayContext | null;

  /* actions */
  playQueue: (tracks: Track[], startIndex?: number, opts?: { shuffle?: boolean; context?: PlayContext }) => void;
  prefetch: (track: Track) => void;
  nextTrack: () => Track | null;
  enqueue: (t: Track) => void;
  enqueueNext: (t: Track) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  jump: (i: number) => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  toggle: () => void;
  seek: (sec: number) => void;
  toggleShuffle: (force?: boolean) => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleFavorite: (t: Track) => boolean;
  isFavorite: (id: string) => boolean;
  startRadio: (t: Track) => Promise<void>;
  setFullscreen: (open: boolean) => void;
  showToast: (msg: string, ms?: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  setAutoDj: (on: boolean) => void;
  radioTopUp: () => void;
}

let shuffleOrder: number[] = [];
let pendingAutoplay = false;
let activeLoadSession = 0;
const prefetched = new Map<string, StreamResult>();
const prefetchedAt = new Map<string, number>();
const streamRequests = new Map<string, Promise<StreamResult>>();
const prefetchQueue: Track[] = [];
let prefetchesActive = 0;
const PREFETCH_TTL_MS = 15 * 60_000;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function makeShuffleOrder(n: number): number[] {
  const o = [...Array(n).keys()];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

/* The plain (unproxied) snapshot. Identity comparisons need this: the store
   proxies its objects, so `playerStore.current !== track` would be true even
   for the very same track. It deliberately reads no reactive dependency —
   actions run in event handlers and timers, where tracking would be noise. */
const snap = (): PlayerState => unwrap(playerStore) as PlayerState;

/* The persisted session (the old Zustand `persist` middleware). The legacy
   per-key entries are still honoured, so an upgrade keeps the listener's
   favourites and history. */
const restored = readLS<Partial<PlayerState>>('mc-player', {});

const [playerStore, setPlayerStore] = createStore<PlayerState>({
  queue: restored.queue ?? [],
  index: restored.index ?? -1,
  current: null,
  playing: false,
  loading: false,
  shuffle: restored.shuffle ?? false,
  repeat: (restored.repeat ?? LS.get<number>('mc_repeat', 0)) as 0 | 1 | 2,
  volume: restored.volume ?? LS.get<number>('mc_vol', 0.9),
  muted: false,
  favorites: restored.favorites ?? LS.get<Track[]>('mc_favs', []),
  history: restored.history ?? LS.get<Track[]>('mc_history', []),
  fullscreen: false,
  toast: null,
  sleepUntil: null,
  autoDj: restored.autoDj ?? LS.get<boolean>('mc_autodj', true),
  autoStart: null,
  sourceContext: null,

  /* --------- internal helpers (not exposed) --------- */

  playQueue(tracks, startIndex = 0, opts) {
    const q = tracks.filter(Boolean);
    shuffleOrder = makeShuffleOrder(q.length);
    const targetIndex = Math.max(0, Math.min(startIndex, q.length - 1));
    const nextTrack = q[targetIndex];
    setPlayerStore({
      queue: q,
      index: targetIndex,
      current: nextTrack || null,
      loading: true,
      playing: true,
      autoStart: null,
      ...(opts?.context ? { sourceContext: opts.context } : {}),
    });
    if (opts?.shuffle && !snap().shuffle) setPlayerStore({ shuffle: true });
    void loadTrack(targetIndex);
  },
  prefetch(track) {
    queuePrefetch(track);
  },
  nextTrack() {
    // Read through the proxy, not the snapshot: a component that asks for the
    // next track has to be woken when the queue moves.
    const queue = playerStore.queue;
    const index = playerStore.index;
    const shuffle = playerStore.shuffle;
    if (!queue.length || index < 0) return null;
    const pos = shuffle ? shuffleOrder.indexOf(index) : index;
    let next = pos + 1;
    if (next >= queue.length) {
      if (playerStore.repeat < 1) return null;
      next = 0;
    }
    const at = shuffle ? shuffleOrder[next] ?? 0 : next;
    return queue[at] ?? null;
  },
  enqueue(t) {
    setPlayerStore({ queue: [...snap().queue, t] });
    shuffleOrder = makeShuffleOrder(snap().queue.length);
  },
  enqueueNext(t) {
    const q = [...snap().queue];
    q.splice(snap().index + 1, 0, t);
    setPlayerStore({ queue: q });
    shuffleOrder = makeShuffleOrder(q.length);
    snap().showToast(`Next up: ${t.title}`);
  },
  removeFromQueue(i) {
    if (i === snap().index) return;
    const q = [...snap().queue];
    q.splice(i, 1);
    const autoStart = snap().autoStart;
    setPlayerStore({
      queue: q,
      index: i < snap().index ? snap().index - 1 : snap().index,
      autoStart: autoStart == null ? null : i < autoStart ? autoStart - 1 : autoStart,
    });
    shuffleOrder = makeShuffleOrder(q.length);
  },
  moveInQueue(from, to) {
    const q = [...snap().queue];
    const [m] = q.splice(from, 1);
    q.splice(to, 0, m);
    let idx = snap().index;
    if (idx === from) idx = to;
    else {
      if (from < idx && to >= idx) idx--;
      else if (from > idx && to <= idx) idx++;
    }
    setPlayerStore({ queue: q, index: idx });
  },
  clearQueue() {
    pendingAutoplay = false;
    audio.pause();
    audio.removeAttribute('src');
    setPlayerStore({ queue: [], index: -1, current: null, playing: false, loading: false });
    document.title = 'VYUNE • Feel Every Frequency';
  },
  jump(i) {
    void loadTrack(i);
  },
  next(auto = false) {
    const { queue, repeat } = snap();
    if (!queue.length) return;
    if (auto && repeat === 2) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    let pos = posInOrder() + 1;
    if (pos >= queue.length) {
      if (repeat >= 1) pos = 0;
      else if (auto) {
        // YT-recommendation behaviour: top up with radio and glide on;
        // if the radio fetch is still in flight, wait briefly for it
        scheduleRadioTopUp();
        const after = snap().queue;
        if (after.length > queue.length) {
          void loadTrack(queue.length);
          return;
        }
        setTimeout(() => {
          const q2 = snap().queue;
          if (q2.length > snap().index) void loadTrack(snap().index + 1);
          else audio.pause();
        }, 1200);
        return;
      } else pos = 0;
    }
    void loadTrack(orderIndex(pos));
  },
  prev() {
    if (audio.currentTime > 3.5) {
      audio.currentTime = 0;
      return;
    }
    const { queue } = snap();
    if (!queue.length) return;
    let pos = posInOrder() - 1;
    if (pos < 0) pos = queue.length - 1;
    void loadTrack(orderIndex(pos));
  },
  toggle() {
    const { current } = snap();
    if (!current) return;
    if (!audio.src) {
      void loadTrack(snap().index >= 0 ? snap().index : 0); // restored session
      return;
    }
    if (audio.paused) {
      pendingAutoplay = true;
      setPlayerStore({ playing: true });
      audio.play().catch(() => {
        pendingAutoplay = false;
        setPlayerStore({ playing: false });
      });
    } else {
      pendingAutoplay = false;
      audio.pause();
      setPlayerStore({ playing: false, loading: false });
    }
  },
  seek(sec) {
    audio.currentTime = Math.max(0, sec);
  },
  toggleShuffle(force) {
    const on = force ?? !snap().shuffle;
    shuffleOrder = makeShuffleOrder(snap().queue.length);
    setPlayerStore({ shuffle: on });
  },
  cycleRepeat() {
    const r = (((snap().repeat as number) + 1) % 3) as 0 | 1 | 2;
    setPlayerStore({ repeat: r });
    LS.set('mc_repeat', r);
  },
  setVolume(v) {
    audio.volume = v;
    setPlayerStore({ volume: v, muted: false });
    LS.set('mc_vol', v);
  },
  toggleMute() {
    const m = !snap().muted;
    audio.volume = m ? 0 : snap().volume;
    setPlayerStore({ muted: m });
  },
  toggleFavorite(t) {
    const favs = snap().favorites;
    const i = favs.findIndex((f) => f.id === t.id);
    const nextFavs = i >= 0 ? favs.filter((_, k) => k !== i) : [t, ...favs].slice(0, 500);
    setPlayerStore({ favorites: nextFavs });
    LS.set('mc_favs', nextFavs);
    return i < 0;
  },
  isFavorite(id) {
    return snap().favorites.some((f) => f.id === id);
  },
  async startRadio(t) {
    snap().showToast('Starting radio…');
    try {
      const { tracks } = await api.radio(t);
      if (tracks?.length) snap().playQueue([t, ...tracks.filter((x) => x.id !== t.id)], 0);
      else snap().showToast('Radio unavailable for this track');
    } catch {
      snap().showToast('Radio unavailable');
    }
  },
  setFullscreen(open) {
    setPlayerStore({ fullscreen: open });
  },
  setAutoDj(on) {
    LS.set('mc_autodj', on);
    setPlayerStore({ autoDj: on });
    if (on) scheduleRadioTopUp();
  },
  radioTopUp() {
    scheduleRadioTopUp();
  },
  setSleepTimer(minutes) {
    const until = minutes ? Date.now() + minutes * 60_000 : null;
    setPlayerStore({ sleepUntil: until });
    snap().showToast(until ? `Sleep timer: ${minutes} min` : 'Sleep timer cleared');
  },
  showToast(msg, ms = 2600) {
    setPlayerStore({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setPlayerStore({ toast: null }), ms);
  },
});

/* --------- internal helpers --------- */

function posInOrder(): number {
  const { shuffle, index } = snap();
  return shuffle ? shuffleOrder.indexOf(index) : index;
}

function orderIndex(pos: number): number {
  const { shuffle, queue } = snap();
  if (!shuffle) return pos;
  const n = queue.length || 1;
  return shuffleOrder[((pos % n) + n) % n] ?? 0;
}

function updateNowPlaying(track: Track) {
  document.title = `${track.title}${track.artists?.length ? ' · ' + track.artists[0] : ''} • VYUNE`;
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: (track.artists || []).join(', '),
        album: track.album || 'VYUNE',
        artwork: thumbCandidates(track).map((src, i) => ({
          src,
          sizes: i === 0 ? '480x480' : '320x180',
          type: 'image/jpeg',
        })),
      });
    }
  } catch {
    /* older browsers */
  }
  // history (dedup, cap 60)
  const hist = [track, ...snap().history.filter((t) => t.id !== track.id)].slice(0, 60);
  LS.set('mc_history', hist);
  setPlayerStore({ history: hist });
}

async function resolveStream(track: Track, refresh = false, wrapper = 'auto'): Promise<StreamResult> {
  if (!refresh) {
    const ready = prefetched.get(track.id);
    if (ready) {
      prefetched.delete(track.id);
      const cachedAt = prefetchedAt.get(track.id) || 0;
      prefetchedAt.delete(track.id);
      if (Date.now() - cachedAt < PREFETCH_TTL_MS) return ready;
    }
  }
  const key = `${track.id}${refresh ? ':refresh' : ''}:${wrapper}`;
  const pending = streamRequests.get(key);
  if (pending) return pending;
  // Share overlapping prefetch/play requests. A failed normal request is
  // allowed to fall through immediately; a forced refresh is reserved for
  // the audio element's actual playback-error recovery path.
  const request = api.stream(track, refresh, undefined, wrapper).finally(() => streamRequests.delete(key));
  streamRequests.set(key, request);
  return request;
}

let recoveredTrackId: string | null = null;
let recoveringStream = false;
let stallTimer: ReturnType<typeof setTimeout> | null = null;

function clearStallTimer() {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = null;
}

async function recoverStream(track: Track, shouldResume: boolean) {
  if (recoveringStream || recoveredTrackId === track.id || snap().current !== track) return;
  recoveringStream = true;
  recoveredTrackId = track.id;
  clearStallTimer();
  const resumeAt = audio.currentTime || 0;
  setPlayerStore({ loading: true });
  try {
    const fallback = await resolveStream(track, true);
    if (snap().current !== track) return;
    const fallbackSrc = fallback.source === 'saavn' ? (fallback.url || fallback.proxy) : (fallback.proxy || fallback.url);
    if (fallbackSrc) {
      audio.src = fallbackSrc;
      applyVolume();
      const restorePosition = () => {
        audio.removeEventListener('loadedmetadata', restorePosition);
        if (resumeAt > 0.5 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
        }
      };
      audio.addEventListener('loadedmetadata', restorePosition);
      if (shouldResume) await audio.play();
    }
  } catch {
    if (snap().current === track) {
      if (track.source !== 'saavn' && /^[\w-]{11}$/.test(track.id)) {
        try {
          await engageIframeFallback(audio, track.id, snap().muted ? 0 : snap().volume);
          if (shouldResume) await audio.play();
          return;
        } catch {
          releaseIframeFallback();
        }
      }
      audio.pause();
      setPlayerStore({ playing: false });
    }
  } finally {
    recoveringStream = false;
    if (snap().current === track) setPlayerStore({ loading: false });
  }
}

function scheduleStreamRecovery(delay: number) {
  if (audio.paused || recoveringStream || recoveredTrackId === snap().current?.id) return;
  clearStallTimer();
  stallTimer = setTimeout(() => {
    const track = snap().current;
    if (track) void recoverStream(track, true);
  }, delay);
}

function queuePrefetch(track: Track, priority = false) {
  // Apple's motion clip for upcoming songs is looked up ahead, so it is ready when they start.
  if (track?.title && track.artists?.[0] && TIERS[currentTier()].motion) {
    void queryClient
      .prefetchQuery({
        queryKey: ['apple-motion-v2', track.id, track.title, (track.artists || []).join('|'), track.album],
        queryFn: ({ signal }) => apiClient.appleMotion(track, signal),
        staleTime: 24 * 60 * 60_000,
      })
      .catch(() => undefined);
  }
  if (!track?.id || snap().current?.id === track.id || prefetched.has(track.id) || streamRequests.has(track.id)) return;
  if (prefetchQueue.some((queued) => queued.id === track.id)) return;

  // Pre-warm artwork for the upcoming track
  if (track && (isVideoThumbnail(track.thumb) || !track.thumb)) {
    void warmTrackArtwork(track);
  }

  if (priority) prefetchQueue.unshift(track);
  else prefetchQueue.push(track);
  // Pointer movement over search results should never create a long queue
  // of requests for tracks the listener has already passed.
  while (prefetchQueue.length > 2) prefetchQueue.pop();
  drainPrefetchQueue();
}

function drainPrefetchQueue() {
  while (prefetchesActive < 2 && prefetchQueue.length) {
    const track = prefetchQueue.shift()!;
    if (snap().current?.id === track.id || prefetched.has(track.id) || streamRequests.has(track.id)) continue;
    prefetchesActive++;
    void resolveStream(track)
      .then((stream) => {
        if (snap().current?.id === track.id) return;
        prefetched.set(track.id, stream);
        prefetchedAt.set(track.id, Date.now());
        while (prefetched.size > 3) {
          const oldest = prefetched.keys().next().value!;
          prefetched.delete(oldest);
          prefetchedAt.delete(oldest);
        }
      })
      .catch(() => {})
      .finally(() => {
        prefetchesActive--;
        drainPrefetchQueue();
      });
  }
}

async function loadTrack(index: number, autoplay = true) {
  const { queue } = snap();
  if (index < 0 || index >= queue.length) return;
  const track = queue[index];
  const session = ++activeLoadSession;

  // 1. Immediately pause old playback and abort old media buffering
  pendingAutoplay = autoplay;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  clearStallTimer();
  recoveredTrackId = null;
  releaseIframeFallback();

  setPlayerStore({ index, current: track, loading: true, playing: autoplay });
  prewarmArtworkColor(track.thumb);
  updateNowPlaying(track);
  schedulePrefetch();

  // If the track came from search/top-songs without an albumId, resolve it in the background
  if (!track.albumId && track.source === 'yt') {
    void fetch(`/api/track?id=${encodeURIComponent(track.id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ albumId?: string; album?: string }>) : null))
      .then((data) => {
        if (!data?.albumId) return;
        track.albumId = data.albumId;
        if (data.album && !track.album) track.album = data.album;
        if (session === activeLoadSession && snap().current?.id === track.id) {
          setPlayerStore({
            current: {
              ...snap().current!,
              albumId: data.albumId,
              album: snap().current?.album || data.album,
            },
          });
        }
      })
      .catch(() => {});
  }

  // If the track is from a video playlist or carries a video still thumbnail, resolve authentic studio album poster
  if (track && (isVideoThumbnail(track.thumb) || track.isUpload || !track.thumb)) {
    const cached = getCachedArtwork(track);
    if (cached && cached !== track.thumb) {
      track.thumb = cached;
      if (session === activeLoadSession && snap().current?.id === track.id) {
        setPlayerStore({
          current: {
            ...snap().current!,
            thumb: cached,
          },
        });
        prewarmArtworkColor(cached);
        updateNowPlaying(snap().current!);
      }
    } else {
      void warmTrackArtwork(track).then((thumb) => {
        if (thumb && thumb !== track.thumb) {
          track.thumb = thumb;
          if (session === activeLoadSession && snap().current?.id === track.id) {
            setPlayerStore({
              current: {
                ...snap().current!,
                thumb,
              },
            });
            prewarmArtworkColor(thumb);
            updateNowPlaying(snap().current!);
          }
        }
      }).catch(() => {});
    }
  } else if (track?.thumb && !isVideoThumbnail(track.thumb)) {
    setCachedArtwork(track, track.thumb);
  }

  let streamResolved = false;
  try {
    const stream = await resolveStream(track);
    if (session !== activeLoadSession || snap().current?.id !== track.id) return; // skipped while resolving

    const chosenSrc = stream.source === 'saavn' ? (stream.url || stream.proxy) : (stream.proxy || stream.url);
    if (!chosenSrc) throw new Error('no_stream_url');

    audio.src = chosenSrc;
    applyVolume();
    audio.load();
    streamResolved = true;

    if (autoplay) {
      setPlayerStore({ loading: true, playing: true });
      audio.play().catch((playErr) => {
        if (session !== activeLoadSession) return;
        if (playErr?.name === 'AbortError') return;
        if (playErr?.name === 'NotAllowedError') {
          pendingAutoplay = false;
          setPlayerStore({ loading: false, playing: false });
          snap().showToast('Playback was blocked by browser. Press Play to start.', 4000);
          return;
        }
        if (stream.proxy && audio.src !== stream.proxy) {
          audio.src = stream.proxy;
          applyVolume();
          audio.load();
          audio.play().catch(() => {
            if (session !== activeLoadSession) return;
            pendingAutoplay = false;
            setPlayerStore({ loading: false, playing: !audio.paused });
          });
        } else {
          pendingAutoplay = false;
          setPlayerStore({ loading: false, playing: !audio.paused });
        }
      });
    } else {
      pendingAutoplay = false;
      setPlayerStore({ loading: false });
    }
    schedulePrefetch();
  } catch (error) {
    if (session !== activeLoadSession || snap().current?.id !== track.id) return;

    // Retry refreshing the stream once
    try {
      recoveredTrackId = track.id;
      const fallback = await resolveStream(track, true);
      if (session !== activeLoadSession || snap().current?.id !== track.id) return;
      const fallbackSrc = fallback.source === 'saavn' ? (fallback.url || fallback.proxy) : (fallback.proxy || fallback.url);
      if (fallbackSrc) {
        audio.src = fallbackSrc;
        applyVolume();
        if (autoplay) {
          await audio.play();
        }
        setPlayerStore({ loading: false, playing: autoplay });
        schedulePrefetch();
        return;
      }
    } catch {
      // Last resort for YouTube: iframe audio fallback
      if (track.source !== 'saavn' && /^[\w-]{11}$/.test(track.id)) {
        try {
          await engageIframeFallback(audio, track.id, snap().muted ? 0 : snap().volume);
          if (session !== activeLoadSession || snap().current?.id !== track.id) {
            releaseIframeFallback();
            return;
          }
          if (autoplay) await audio.play();
          setPlayerStore({ loading: false, playing: autoplay });
          return;
        } catch {
          releaseIframeFallback();
        }
      }
    }

    audio.pause();
    pendingAutoplay = false;
    if (!streamResolved) {
      audio.removeAttribute('src');
    }
    setPlayerStore({ playing: false, loading: false });
    const detail =
      error instanceof Error && error.name === 'NotAllowedError'
        ? 'Playback was blocked by the browser. Press Play to start this song.'
        : `Couldn’t play “${track.title}”. Press Play to retry.`;
    snap().showToast(detail, 5000);
  } finally {
    if (session === activeLoadSession && snap().current?.id === track.id && !pendingAutoplay) {
      setPlayerStore({ loading: false });
    }
  }
}

/* YouTube-style autoplay: keep YouTube's own suggested queue going when
   the queue runs dry. JioSaavn tracks are matched to a catalog seed server
   side, while their original JioSaavn stream remains the selected source. */
let toppingUp = false;
function scheduleRadioTopUp() {
  const { queue, index, current, autoDj } = snap();
  if (!autoDj) return;
  if (!current || toppingUp || queue.length - index > 2) return;
  toppingUp = true;
  api
    .radio(current)
    .then(({ tracks }) => {
      if (!tracks?.length) return;
      const have = new Set(snap().queue.map((t) => t.id));
      const currentTitle = current.title?.toLowerCase().replace(/[\s\W]+/g, ' ').trim() || '';
      const fresh = tracks
        .filter((t) => {
          if (have.has(t.id) || t.id === current.id) return false;
          const tTitle = t.title?.toLowerCase().replace(/[\s\W]+/g, ' ').trim() || '';
          if (currentTitle && (tTitle === currentTitle || (currentTitle.length > 5 && (tTitle.startsWith(currentTitle) || currentTitle.startsWith(tTitle))))) return false;
          return true;
        })
        .slice(0, 20);
      if (fresh.length) {
        const before = snap().queue.length;
        setPlayerStore({ queue: [...snap().queue, ...fresh], autoStart: snap().autoStart ?? before });
        // If the song ended while radio was still resolving, start the first
        // recommendation as soon as it arrives instead of leaving playback
        // paused until the listener presses Next.
        const reachedEnd = audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration - 0.5);
        if (reachedEnd && snap().current === current) void loadTrack(before);
      }
    })
    .catch(() => {})
    .finally(() => {
      toppingUp = false;
    });
}

function schedulePrefetch() {
  const { queue, current } = snap();
  const ni = orderIndex(posInOrder() + 1);
  const track = queue[ni];
  if (!track || track.id === current?.id || prefetched.has(track.id)) return;
  queuePrefetch(track, true);
}

/* --------- audio element events --------- */

audio.addEventListener('play', () => setPlayerStore({ playing: true }));
audio.addEventListener('playing', () => {
  pendingAutoplay = false;
  clearStallTimer();
  setPlayerStore({ playing: true, loading: false });
});
audio.addEventListener('pause', () => {
  if (!pendingAutoplay && !snap().loading) setPlayerStore({ playing: false });
});
audio.addEventListener('canplay', () => {
  if ((snap().playing || pendingAutoplay) && audio.paused) audio.play().catch(() => {});
});
audio.addEventListener('timeupdate', clearStallTimer);
audio.addEventListener('waiting', () => scheduleStreamRecovery(4500));
audio.addEventListener('stalled', () => scheduleStreamRecovery(6500));
audio.addEventListener('timeupdate', () => {
  const { queue, index } = snap();
  if (index >= 0 && queue.length - index <= 2 && audio.duration - audio.currentTime <= 45) {
    scheduleRadioTopUp();
  }
});
audio.addEventListener('ended', () => {
  setPlayerStore({ playing: false });
  snap().next(true);
});
audio.addEventListener('loadedmetadata', () => {
  // fill missing durations from the element — metadata is truth
  const cur = snap().current;
  if (cur && (!cur.duration || cur.duration <= 0) && isFinite(audio.duration)) {
    cur.duration = Math.round(audio.duration);
    setPlayerStore({ queue: [...snap().queue] });
  }
  try {
    navigator.mediaSession.setPositionState?.({
      duration: audio.duration || 0,
      playbackRate: 1,
      position: audio.currentTime || 0,
    });
  } catch {
    /* noop */
  }
});
audio.addEventListener('error', () => {
  const track = snap().current;
  if (!track || snap().loading || !audio.error) return;
  void recoverStream(track, snap().playing || !audio.paused);
});

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => audio.play().catch(() => {}));
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('previoustrack', () => snap().prev());
  ms.setActionHandler('nexttrack', () => snap().next(false));
  ms.setActionHandler('seekto', (d) => {
    if (d.seekTime != null) audio.currentTime = d.seekTime;
  });
}

/* ------------------------------ the store ------------------------------ */

/**
 * The player store.
 *
 * `playerStore.current` read inside JSX is reactive: Solid compiles the JSX
 * into a graph and re-runs the expression when that property changes.
 * `getPlayerState()` is the plain snapshot, for event handlers, timers and
 * anywhere identity matters.
 */
export { playerStore };

/** The player state as a plain object — for code that must not track. */
export function getPlayerState(): PlayerState {
  return snap();
}

/* ---------- persistence (the old Zustand `persist` middleware) ---------- */

persistSlice(
  'mc-player',
  () => ({
    queue: playerStore.queue,
    index: playerStore.index,
    shuffle: playerStore.shuffle,
    repeat: playerStore.repeat,
    volume: playerStore.volume,
    favorites: playerStore.favorites,
    history: playerStore.history,
    autoDj: playerStore.autoDj,
  }),
  (value) => writeLS('mc-player', value),
);

/* ---------- volume control + sleep timer daemon ---------- */

function applyVolume() {
  const target = snap().muted ? 0 : snap().volume;
  audio.volume = target;
}

// sleep timer
setInterval(() => {
  const st = snap();
  if (st.sleepUntil && Date.now() >= st.sleepUntil) {
    st.setSleepTimer(null);
    audio.pause();
    st.showToast('Sleep timer — playback paused. Good night.');
  }
}, 5000);

/* hydrate audio + restore last session's now-playing (no autoplay) */
{
  const s = snap();
  audio.volume = s.muted ? 0 : s.volume;
  if (!s.current && s.queue.length && s.index >= 0 && s.index < s.queue.length) {
    setPlayerStore({ current: s.queue[s.index] });
    document.title = `${s.queue[s.index].title} • VYUNE`;
  }
}

/* debug/test handles (audio is a singleton, not in the DOM) */
(window as unknown as { __mcAudio: HTMLAudioElement }).__mcAudio = audio;
(window as unknown as { __mcPlayer: typeof playerStore }).__mcPlayer = playerStore;

/* ------------------------------ thumbnail helpers ------------------------------ */

/** Rewrite the size token in a CDN art URL (yt/saavn/googleusercontent). */
const sized = (url: string, px: number) => {
  if (!url) return '';
  const u = String(url);
  if (/mzstatic\.com/.test(u)) {
    return u.replace(/\d+x\d+bb\./, `${px}x${px}bb.`);
  }
  if (/googleusercontent\.com|ggpht\.com/.test(u)) {
    const base = u.split(/[=?]/)[0];
    return `${base}=w${px}-h${px}-l90-rj`;
  }
  if (/saavncdn\.com/.test(u)) {
    const saavnSize = px >= 500 ? 500 : px >= 150 ? 150 : 50;
    if (/-(50x50|150x150|500x500)(\.\w+)?$/.test(u)) {
      return u.replace(/-(50x50|150x150|500x500)(\.\w+)?$/, `-${saavnSize}x${saavnSize}.jpg`);
    }
    return u.replace(/\.jpg$/, `-${saavnSize}x${saavnSize}.jpg`);
  }
  if (/ytimg\.com/i.test(u) && px >= 300) {
    // Prefer hq720 if requested for large poster, but keep original available as immediate fallback
    return u.replace(/(?:mqdefault|default|sddefault)\.(jpg|webp)/i, 'hqdefault.$1');
  }
  return u;
};

const hiRes = (url: string) => {
  if (!url) return '';
  const u = String(url);
  if (/ytimg\.com/i.test(u)) {
    return u.replace(/(?:hqdefault|mqdefault|default|sddefault)\.(jpg|webp)/i, 'hq720.$1');
  }
  return sized(u, 1200);
};

/** Use catalogue/album artwork preferred; falls back to available thumbnail. */
export function thumbCandidates(t: Pick<Track, 'thumb' | 'source' | 'id' | 'title' | 'artists' | 'album'>): string[] {
  const cached = getCachedArtwork(t as Track);
  const src = cached || t.thumb;
  if (!src) return [];
  return [sized(src, 544)];
}

/** Fullscreen poster: highest-resolution catalogue artwork preferred; falls back to available thumbnail instantly. */
export function posterCandidates(t: Pick<Track, 'thumb' | 'source' | 'id' | 'title' | 'artists' | 'album'>): string[] {
  const cached = getCachedArtwork(t as Track);
  const src = cached || t.thumb;
  if (!src) return [];
  const u = String(src);
  if (/ytimg\.com/i.test(u)) {
    // Return reliable hqdefault thumbnail first so player opens instantly with no 404s
    const base = u.replace(/(?:mqdefault|default|sddefault)\.(jpg|webp)/i, 'hqdefault.$1');
    return [base];
  }
  const high = hiRes(src);
  return high !== src ? [high, src] : [src];
}
