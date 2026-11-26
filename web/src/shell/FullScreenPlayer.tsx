import { Maximize, Minimize } from 'lucide-solid';
import { useQuery } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { useLocation } from '@solidjs/router';
import {
  BackwardIcon,
  ForwardIcon,
  LyricsActiveIcon,
  LyricsIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
} from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { Marquee } from '@/components/music/Marquee';
import { SongTitle } from '@/components/music/SongTitle';
import { ExplicitBadge } from '@/components/music/ExplicitBadge';
import { FavoriteButton } from '@/components/music/FavoriteButton';
import { albumHref, artistLink } from '@/components/music/links';
import { AppleMotionArtwork } from '@/components/music/AppleMotionArtwork';
import { MvPlayer } from '@/components/music/MvPlayer';
import { artModeStore } from '@/store/artMode';
import { ArtVolume } from './ArtControls';
import { PlayerMenu } from './PlayerMenu';
import { PrefetchLink } from '@/components/PrefetchLink';
import { api } from '@/lib/api';
import { cleanArtistDisplay } from '@/lib/artistCredits';
import { posterCandidates, thumbCandidates, playerStore } from '@/store/player';
import { LyricsPanel, LyricPreview } from './LyricsPanel';
import { ArtworkBackdrop } from './ArtworkBackdrop';
import { UpNext } from './UpNext';
import { useScrubber } from './useScrubber';
import { useSongTint } from '@/lib/useSongTint';

/** Whether the browser is in its own full-screen mode. */
function useBrowserFullScreen() {
  const [full, setFull] = createSignal(document.fullscreenElement !== null);
  const listener = () => setFull(document.fullscreenElement !== null);
  document.addEventListener('fullscreenchange', listener);
  onCleanup(() => document.removeEventListener('fullscreenchange', listener));
  return full;
}

/** The seek line under the track's names: thicker on hover, with the times beneath its ends. */
function Scrubber() {
  const { setBarRef, setElapsedRef, setRemainingRef, dragging, handlers } = useScrubber();
  return (
    <div class="group/scrub" data-dragging={dragging() || undefined}>
      {/* A taller hit area than the line it carries. */}
      <div class="group/hit flex h-5 cursor-pointer touch-none items-center" {...handlers}>
        <div
          class="h-1.5 flex-1 overflow-hidden rounded-[999px] bg-white/15 backdrop-blur-md transition-[height,background-color] duration-200 ease-out group-hover/hit:h-2.5 group-data-dragging/scrub:h-2.5 shadow-[inset_0_1px_1px_rgba(0,0,0,0.4)]"
          aria-hidden="true"
        >
          <div
            ref={setBarRef}
            class="size-full origin-left scale-x-(--progress) bg-gradient-to-r from-white/90 via-white to-white shadow-[0_0_16px_rgba(255,255,255,0.75)] transition-[background-color,shadow] duration-200 ease-out [--progress:0] group-hover/hit:shadow-[0_0_22px_rgba(255,255,255,1)]"
          />
        </div>
      </div>
      <div class="mt-1 flex justify-between type-[600_12px/15px] tabular-nums text-tertiary">
        <span ref={setElapsedRef} />
        <span ref={setRemainingRef} />
      </div>
    </div>
  );
}

// The transport's three kinds of control; the glass itself lives in styles/glass.css.
const toggleBtn = 'fs-key';
const skip = 'fs-skip';

/** Shuffle, previous, play/pause, next, repeat. No volume: the pill keeps that. */
function Transport() {
  const hasTrack = () => playerStore.current !== null;
  const playing = () => playerStore.playing || playerStore.loading;
  const hasNext = () => playerStore.index + 1 < playerStore.queue.length || playerStore.repeat !== 0 || playerStore.index >= 0;

  return (
    <div class="mx-auto mt-[clamp(8px,1.6vh,16px)] mb-0 flex h-13 w-[min(100%,315px)] items-center justify-between">
      <button class={toggleBtn} aria-label="Shuffle" aria-pressed={playerStore.shuffle} onClick={() => playerStore.toggleShuffle()}>
        <ShuffleIcon size={30} />
      </button>
      <button class={skip} disabled={!hasTrack()} aria-label="Previous" onClick={() => playerStore.prev(false)}>
        <BackwardIcon size={40} />
      </button>
      <button
        class="fs-puck glance"
        data-glint
        disabled={!hasTrack()}
        aria-label={playing() ? 'Pause' : 'Play'}
        onClick={() => playerStore.toggle()}
      >
        <Show when={playing()} fallback={<PlayIcon size={44} />}>
          <PauseIcon size={44} />
        </Show>
      </button>
      <button class={skip} disabled={!hasTrack() || !hasNext()} aria-label="Next" onClick={() => playerStore.next(false)}>
        <ForwardIcon size={40} />
      </button>
      <button
        class={toggleBtn}
        aria-label={playerStore.repeat === 2 ? 'Repeat one' : playerStore.repeat === 1 ? 'Repeat all' : 'Repeat'}
        aria-pressed={playerStore.repeat !== 0}
        onClick={() => playerStore.cycleRepeat()}
      >
        <Show when={playerStore.repeat === 2} fallback={<RepeatIcon size={30} />}>
          <RepeatOneIcon size={30} />
        </Show>
      </button>
    </div>
  );
}

// Browser full screen and the column toggles, in the corners: small glass chips.
const chrome = 'fs-chip absolute z-1';

/** The artists, each name its own link where the catalogue linked one. */
function Credits() {
  const current = () => playerStore.current;
  const rawArtists = () => {
    const c = current();
    if (!c) return [];
    const fromArtists = (c.artists || []).map(cleanArtistDisplay).filter(Boolean);
    if (fromArtists.length === 1 && (c.artistIds?.length ?? 0) <= 1 && /[,&]|\b(?:feat|ft)\.?\b/i.test(fromArtists[0]!)) {
      const split = fromArtists[0]!
        .split(/\s*(?:,|&|\b(?:feat|ft|featuring)\.?\b)\s*/i)
        .map(cleanArtistDisplay)
        .filter(Boolean);
      if (split.length > 1) return split;
    }
    if (fromArtists.length > 0) return fromArtists;
    const cleanChan = cleanArtistDisplay(c.channel || '');
    if (cleanChan) return [cleanChan];
    return ['Artist unavailable'];
  };
  const artistIds = () => playerStore.current?.artistIds || [];

  return (
    <For each={rawArtists()}>
      {(artist, i) => {
        const id = artistIds()[i()];
        const href = () => artistLink(id, artist);
        const total = rawArtists().length;
        const isLast = () => i() === total - 1;
        const isSecondToLast = () => i() === total - 2;
        return (
          <span>
            <Show when={href()} fallback={<span>{artist}</span>}>
              <PrefetchLink class="hover:underline" to={href()!} hint={{ title: artist }}>
                {artist}
              </PrefetchLink>
            </Show>
            <Show when={!isLast()}>
              <span>{total === 2 || isSecondToLast() ? ' & ' : ', '}</span>
            </Show>
          </span>
        );
      }}
    </For>
  );
}

/** The sheet's own motion. Decelerating on the way in, the iOS sheet curve on the way out. */
const EASE_IN = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)';
const ENTER_MS = 520;
const EXIT_MS = 400;
const reducedMotion = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The full-screen player (report §7): the artwork on the left with the
 * track's names, the seek line and the transport under it; the lyrics, the
 * same lyrics panel as the side panel's, on the right; all over a mesh
 * gradient of the artwork's colours. Without lyrics, the artwork column sits
 * in the middle on its own, as Apple's does.
 *
 * Lifecycle: the Layout keeps this mounted while `playerStore.fullscreen` is
 * true *and* for the length of the exit animation, then calls `onExited`.
 * Every way out (Escape, the handle, a pull, a link, an empty queue) simply
 * clears `fullscreen`; the exit below is the only place that animates it.
 * Only `transform` and `opacity` are animated, so the sheet stays on the
 * compositor, and the page behind it is never touched.
 */
export function FullScreenPlayer(props: { onExited: () => void }) {
  const location = useLocation();
  const openedAt = location.pathname;
  const [panel, setPanel] = createSignal<'lyrics' | 'queue' | null>(null);
  const browserFullScreen = useBrowserFullScreen();
  const [idle, setIdle] = createSignal(false);
  // True once the sheet has finished arriving: the heavy extras (the motion
  // clip, its frosted copy) wait for it so the slide itself never competes.
  const [settled, setSettled] = createSignal(false);
  // The playing song's motion artwork, once it is on screen: the backdrop frosts a copy of it.
  const [motionVideo, setMotionVideo] = createSignal<HTMLVideoElement | null>(null);
  const [mvStreamSrc, setMvStreamSrc] = createSignal<string | null>(null);
  const [mvReady, setMvReady] = createSignal(false);
  const tint = useSongTint();

  let close!: HTMLButtonElement;
  let rootRef!: HTMLDivElement;
  let motion: Animation | null = null;
  let dragStartY: number | null = null;
  let dragged = false;
  let pull = 0;
  let velocity = 0;
  let lastY = 0;
  let lastT = 0;
  // Whether this player put the page in the browser's full screen, so closing it leaves it again.
  let enteredBrowserFullScreen = false;
  let disposed = false;

  const catalogArtwork = useQuery(() => ({
    queryKey: ['catalog-artwork', playerStore.current?.id],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      playerStore.current ? api.artwork(playerStore.current, signal) : Promise.resolve({ thumb: null }),
    enabled: !!playerStore.current && playerStore.current.source === 'yt',
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  }));

  /** What the sheet looks like right now, mid-animation or mid-drag. */
  const snapshot = (): Keyframe => {
    const style = getComputedStyle(rootRef);
    return { transform: style.transform === 'none' ? 'translate3d(0,0,0)' : style.transform, opacity: style.opacity };
  };

  /** The sheet has arrived: drop the animation so it rests in its natural style, with no transform left on it. */
  const rest = (animation: Animation) => {
    animation.cancel();
    if (motion === animation) motion = null;
    rootRef.style.transform = '';
    rootRef.style.opacity = '';
  };

  const run = (frames: Keyframe[], duration: number, easing: string) => {
    motion?.cancel();
    rootRef.style.transform = '';
    motion = rootRef.animate(frames, { duration: reducedMotion() ? 1 : duration, easing, fill: 'both' });
    return motion;
  };

  const enter = () => {
    if (!rootRef?.isConnected) return;
    const from: Keyframe = motion ? snapshot() : { transform: 'translate3d(0, 5%, 0) scale(0.972)', opacity: 0 };
    rootRef.style.pointerEvents = '';
    const animation = run([from, { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }], ENTER_MS, EASE_IN);
    setSettled(false);
    animation.finished.then(
      () => {
        if (disposed || !playerStore.fullscreen) return;
        // Let the arrival paint before the extras mount.
        requestAnimationFrame(() => setSettled(true));
        rest(animation);
      },
      () => undefined,
    );
  };

  const exit = () => {
    // Nothing on screen to slide away (the queue ended and the sheet is already gone).
    if (!rootRef?.isConnected) return props.onExited();
    const from = snapshot();
    rootRef.style.pointerEvents = 'none';
    const animation = run(
      [
        { ...from, offset: 0 },
        { opacity: from.opacity, offset: 0.45 },
        { transform: 'translate3d(0, 100%, 0) scale(0.95)', opacity: 0, offset: 1 },
      ],
      EXIT_MS,
      EASE_OUT,
    );
    animation.finished.then(
      () => {
        if (!disposed && !playerStore.fullscreen) props.onExited();
      },
      () => undefined,
    );
  };

  /** A pull that was not far enough: the sheet springs back from wherever it was let go. */
  const settleBack = () => {
    const from = snapshot();
    run([from, { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }], 360, EASE_IN)
      .finished.then(
        () => {
          if (disposed || !playerStore.fullscreen) return;
          if (motion) rest(motion);
        },
        () => undefined,
      );
  };

  const dismiss = () => playerStore.setFullscreen(false);

  onMount(() => {
    enter();
    onCleanup(() => {
      disposed = true;
      motion?.cancel();
    });
  });
  // Closing plays the exit; a reopen during it slides the sheet back in from wherever it is.
  createEffect(
    on(
      () => playerStore.fullscreen,
      (open) => (open ? enter() : exit()),
      { defer: true },
    ),
  );

  onMount(() => {
    const page = document.getElementById('scrollable-page');
    const previousOverflow = page?.style.overflowY ?? '';
    if (page) page.style.overflowY = 'hidden';
    onCleanup(() => {
      if (page) page.style.overflowY = previousOverflow;
    });
  });

  onMount(() => {
    let timer = 0;
    const wake = () => {
      if (idle()) setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2600);
    };
    wake();
    const events: (keyof WindowEventMap)[] = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    onCleanup(() => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    });
  });

  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    close?.focus({ preventScroll: true });
    onCleanup(() => {
      if (enteredBrowserFullScreen && document.fullscreenElement) void document.exitFullscreen();
      opener?.focus({ preventScroll: true });
    });
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Let a menu or the command palette consume its own Escape first.
      if (document.querySelector('[role="menu"], .command-palette')) return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  // A title, artist or album link went somewhere: get out of the way so the page shows.
  createEffect(() => {
    if (location.pathname !== openedAt) playerStore.setFullscreen(false);
  });

  // Nothing left to show once the queue ends.
  createEffect(() => {
    if (!playerStore.current) playerStore.setFullscreen(false);
  });

  // Reset MV ready state strictly on track switch or mode exit (never spuriously during playback)
  let lastFsTrackId: string | null = null;
  createEffect(() => {
    const curId = playerStore.current?.id || null;
    if (curId !== lastFsTrackId) {
      lastFsTrackId = curId;
      setMvReady(false);
    } else if (artModeStore.mode !== 'mv') {
      setMvReady(false);
    }
  });

  const toggleBrowserFullScreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      // The whole page, not this overlay: menus portal to <body> and must stay visible.
      void document.documentElement.requestFullscreen().then(
        () => (enteredBrowserFullScreen = true),
        () => undefined,
      );
    }
  };

  /* Pull the handle to put the sheet away. It follows the pointer one to one
     (transform only), and on release it either carries on down at the speed it
     was let go, or springs back. */
  const onHandlePointerDown = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    motion?.cancel();
    motion = null;
    dragStartY = event.clientY;
    lastT = performance.now();
    lastY = event.clientY;
    velocity = 0;
    dragged = false;
    pull = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandlePointerMove = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (dragStartY == null) return;
    const now = performance.now();
    const distance = Math.max(0, event.clientY - dragStartY);
    if (distance > 6) dragged = true;
    if (now > lastT) velocity = (event.clientY - lastY) / (now - lastT);
    lastY = event.clientY;
    lastT = now;
    // A touch of resistance past the first screen-third keeps it feeling attached to the hand.
    const limit = window.innerHeight;
    pull = distance < limit * 0.33 ? distance : limit * 0.33 + (distance - limit * 0.33) * 0.72;
    const scale = Math.max(0.94, 1 - pull / (limit * 18));
    rootRef.style.transform = `translate3d(0, ${pull}px, 0) scale(${scale})`;
  };
  const onHandlePointerUp = () => {
    if (dragStartY == null) return;
    const flicked = velocity > 0.55 && pull > 24;
    const farEnough = pull > Math.min(120, window.innerHeight * 0.16);
    dragStartY = null;
    if (flicked || farEnough) dismiss();
    else if (dragged) settleBack();
  };

  const togglePanel = (p: 'lyrics' | 'queue') => setPanel((on) => (on === p ? null : p));
  // The chrome that steps aside when the mouse rests.
  const fades = 'transition-opacity duration-500 ease-out group-data-[idle=true]:opacity-0 group-data-[idle=true]:pointer-events-none';

  return (
    <Show when={playerStore.current}>
      {(current) => {
        const alternateThumb = () => catalogArtwork.data?.thumb;
        const originalIsVideoThumbnail = () => /(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(current().thumb || '');
        const isValidArt = (url?: string | null) => !!url && !/(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(url);
        const artworkTrack = () => (originalIsVideoThumbnail() && isValidArt(alternateThumb()) ? { ...current(), thumb: alternateThumb()! } : current());
        const poster = () => posterCandidates(artworkTrack());
        const showLyrics = () => panel() === 'lyrics';
        const showQueue = () => panel() === 'queue';
        const column = () => showLyrics() || showQueue();

        // Cinematic 16:9 in MV mode once video has loaded and is ready;
        // stays in pure square 1:1 while buffering / resolving to eliminate jarring aspect ratio jumps.
        const isMvActive = createMemo(() => artModeStore.mode === 'mv' && mvReady());

        // Responsive artwork stage width & height: sleek cinematic 16:9 in active MV mode,
        // locked square 1:1 in static art / motion visualizer mode / buffering MV mode
        const stageWidth = createMemo(() => {
          if (isMvActive()) {
            return 'min(44vw, calc((100dvh - 240px) * 16 / 9), 680px)';
          }
          return 'min(42vw, calc(100dvh - 160px), 640px)';
        });

        const stageHeight = createMemo(() => {
          if (isMvActive()) {
            return 'calc(min(44vw, calc((100dvh - 240px) * 16 / 9), 680px) * 9 / 16)';
          }
          return stageWidth();
        });

        const [lyricsEverOpened, setLyricsEverOpened] = createSignal(false);
        createEffect(() => {
          if (showLyrics()) setLyricsEverOpened(true);
        });

        const playingContext = () => playerStore.sourceContext;
        const playingFromHeader = createMemo(() => {
          const ctx = playingContext();
          if (ctx?.type === 'search') return 'PLAYING FROM SEARCH';
          if (ctx?.type === 'album') return 'PLAYING FROM ALBUM';
          if (ctx?.type === 'playlist') return 'PLAYING FROM PLAYLIST';
          if (ctx?.type === 'artist') return 'PLAYING FROM ARTIST';
          if (current().album) return 'PLAYING FROM ALBUM';
          if (current().artists?.length) return 'PLAYING FROM ARTIST';
          return 'PLAYING FROM VYUNE';
        });
        const playingFromTitle = createMemo(() => {
          const ctx = playingContext();
          if (ctx?.title) return ctx.title;
          if (current().album) return current().album;
          if (current().artists?.length) return current().artists.join(', ');
          return 'Music';
        });
        return (
          <div
            // Over everything but menus and dialogs, which portal above it. The on-dark colours come from tokens.css.
            // --art, the artwork's side: Apple's 461px at 1440px wide, and never taller than the screen leaves room for.
            class={`fullscreen group fixed inset-0 z-[calc(var(--z-contextual-menus)-2)] isolate overflow-hidden bg-[#050505] text-primary will-change-transform [--art:min(43vw,calc(100dvh-140px),880px)] max-md:[--art:min(54vw,calc(100dvh-420px),340px)]`}
            role="dialog"
            aria-modal="true"
            aria-label="Now Playing"
            data-full-screen
            data-paused={!(playerStore.playing || playerStore.loading) || undefined}
            data-idle={idle() || undefined}
            ref={rootRef}
            style={tint()}
          >
            <ArtworkBackdrop
              artworkUrl={poster()[0] ?? thumbCandidates(artworkTrack())[0] ?? current().thumb ?? null}
              fallbackUrl={current().thumb}
              videoSrc={artModeStore.mode === 'mv' ? mvStreamSrc() : null}
              motionVideo={settled() ? motionVideo() : null}
              mode={artModeStore.mode}
              videoReady={artModeStore.mode === 'mv' && isMvActive()}
            />

            {/* The pull handle spans the top edge so it is easy to catch with a thumb. */}
            <button
              ref={close}
              class={`player-shutter-handle ${fades}`}
              aria-label="Minimize player"
              title="Pull down to minimize"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
              onClick={() => {
                if (dragged) {
                  dragged = false;
                  return;
                }
                dismiss();
              }}
            >
              <span />
            </button>
            <Show when={document.fullscreenEnabled}>
              <button
                class={`${chrome} ${fades} top-4 right-5`}
                data-glint
                aria-label={browserFullScreen() ? 'Exit full screen' : 'Enter full screen'}
                onClick={toggleBrowserFullScreen}
              >
                <Show when={browserFullScreen()} fallback={<Maximize size={17} />}>
                  <Minimize size={17} />
                </Show>
              </button>
            </Show>

            {/* Master stage layout: Locked left column with zero jitter on lyrics/art toggle */}
            <div
              class={`fs-lyrics grid h-full items-center justify-center py-16 max-md:px-6 max-md:pb-18 gap-x-[clamp(36px,5vw,84px)] pl-[clamp(28px,4.5vw,88px)] pr-[clamp(20px,3.5vw,68px)] ${
                showLyrics()
                  ? 'max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[minmax(0,1fr)_auto] max-md:items-stretch max-md:gap-y-4'
                  : 'max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)] max-md:items-stretch max-md:gap-y-4'
              }`}
              style={{
                'grid-template-columns': `${stageWidth()} minmax(0, 1fr)`,
              }}
              data-lyrics={column() || undefined}
            >
              <section
                class={`poster-col flex min-w-0 flex-col${showQueue() ? ' max-md:order-2 max-md:w-full' : ''}`}
                style={{
                  width: stageWidth(),
                  'max-width': '100%',
                }}
                aria-label="Player"
              >
                {/* Apple-grade squarish card with subtle curve, morphing smoothly into 16:9 only once MV is playing & ready */}
                <div
                  class={`fs-poster group/poster relative rounded-[16px] overflow-hidden bg-black/50 shadow-[0_28px_70px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.28)] border border-white/18 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer select-none group-data-[idle=true]:scale-[0.98]${playerStore.playing || playerStore.loading ? '' : ' scale-[0.94]'}`}
                  style={{
                    width: stageWidth(),
                    height: stageHeight(),
                    'max-width': '100%',
                  }}
                  onClick={() => {
                    artModeStore.cycle();
                  }}
                >
                  <div class="absolute inset-0 size-full">
                    {/* Base Layer: High-Res Album Artwork — ALWAYS VISIBLE! Zero black screen while MV resolves */}
                    <div
                      class="absolute inset-0 size-full transition-opacity duration-500 ease-out"
                      classList={{
                        'opacity-100': !isMvActive(),
                        'opacity-0': isMvActive(),
                      }}
                    >
                      <Show when={poster()[0]}>
                        <Artwork
                          candidates={poster()}
                          track={artworkTrack()}
                          displayWidth={900}
                          radius="14px"
                          eager
                          class="size-full rounded-[14px] object-cover"
                        />
                      </Show>
                    </div>

                    {/* Layer 2: Apple Motion Visualizer */}
                    <Show when={artModeStore.mode === 'motion' && settled()}>
                      <div
                        class="absolute inset-0 size-full overflow-hidden rounded-[14px] transition-opacity duration-500 ease-out"
                        classList={{
                          'opacity-100': artModeStore.mode === 'motion',
                          'opacity-0': artModeStore.mode !== 'motion',
                        }}
                      >
                        <AppleMotionArtwork track={current()} onVideo={setMotionVideo} />
                      </div>
                    </Show>

                    {/* Layer 3: YouTube 16:9 Music Video with Smooth Fade-in */}
                    <Show when={artModeStore.mode === 'mv'}>
                      <div
                        class="absolute inset-0 size-full overflow-hidden rounded-[14px] z-10 transition-opacity duration-500 ease-out"
                        classList={{
                          'opacity-100 pointer-events-auto': isMvActive(),
                          'opacity-0 pointer-events-none': !isMvActive(),
                        }}
                      >
                        <MvPlayer
                          track={current()}
                          active={true}
                          onVideo={setMotionVideo}
                          onStreamSrc={setMvStreamSrc}
                          onReady={setMvReady}
                          class="size-full rounded-[14px]"
                        />
                      </div>
                    </Show>
                  </div>
                </div>

                {/* With Up Next open the controls sit under the poster in the same style as the main view. */}
                <Show when={showQueue()}>
                  <div class={`${fades} mt-[clamp(24px,4vh,44px)] max-md:mt-0 flex flex-col gap-2`}>
                    <SongTitle
                      title={current().title}
                      href={current().albumId ? albumHref(current().albumId) : (current().album ? `/search?q=${encodeURIComponent(current().album)}&filter=albums` : undefined)}
                      onClick={() => playerStore.setFullscreen(false)}
                      class="text-[clamp(18px,1.6vw,22px)] leading-[1.15] font-bold tracking-[-0.03em] [font-family:var(--font-family)]"
                    />
                    <Marquee class="mt-0.5 text-[15px] leading-[1.3] font-medium tracking-[-0.014em] text-secondary [font-family:var(--font-family)]" render={() => <Credits />} />
                    <div class="mt-3 flex flex-col gap-2">
                      <Scrubber />
                      <Transport />
                    </div>
                  </div>
                </Show>
              </section>

              {/* Not in lyrics or Up Next: the track's names, the line being sung, the seek bar and the transport, beside the artwork. */}
              <Show when={!column()}>
                <section
                  class="flex min-h-0 min-w-0 animate-fade-in flex-col justify-between self-center py-2 transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    height: 'var(--art)',
                    'max-height': '100%',
                  }}
                  aria-label="Now playing controls"
                >
                  {/* Apple Music: Playing from search/album at top parallel to artwork on same line */}
                  <div class="flex items-center gap-2 select-none min-w-0 max-w-full">
                    <span class="text-[13px] font-bold tracking-[0.08em] uppercase text-white/55 [font-family:var(--font-display)] shrink-0">
                      {playingFromHeader()}
                    </span>
                    <Show when={playingFromTitle()}>
                      <span class="text-[14px] font-bold text-white/50 select-none mx-0.5">•</span>
                      <span class="truncate text-[13px] font-bold tracking-[0.08em] uppercase text-white/55 [font-family:var(--font-display)]">
                        {playingFromTitle()}
                      </span>
                    </Show>
                  </div>

                  <div class="flex min-h-0 flex-col justify-center my-auto py-2">
                    {/* Song Title & Artist: slightly more gap than before (mb-9 = 36px) */}
                    <div class="mb-9 flex items-start justify-between gap-5">
                      <div class="min-w-0 flex-1">
                        <h1 class="flex min-w-0 items-center gap-2 text-[clamp(28px,3vw,40px)] leading-[1.15] font-bold tracking-[-0.038em] [font-family:var(--font-family)]">
                          <SongTitle
                            title={current().title}
                            href={current().albumId ? albumHref(current().albumId) : (current().album ? `/search?q=${encodeURIComponent(current().album)}&filter=albums` : undefined)}
                            onClick={() => playerStore.setFullscreen(false)}
                            class="flex-1"
                          />
                          <Show when={current().explicit}>
                            <ExplicitBadge size={15} />
                          </Show>
                        </h1>
                        <Marquee
                          class="mt-2 text-[clamp(16px,1.4vw,19px)] leading-[1.35] font-medium tracking-[-0.016em] text-secondary [font-family:var(--font-family)]"
                          render={() => <Credits />}
                        />
                      </div>
                      <FavoriteButton track={current()} class="fs-chip flex-none !size-10" size={20} />
                    </div>

                    {/* The one-line lyric: sits close, standing just above the seek bar */}
                    <div class="mb-0 flex items-end">
                      <LyricPreview />
                    </div>
                    <div>
                      <Scrubber />
                    </div>
                    <div class="mt-4">
                      <Transport />
                    </div>
                    <div class="mt-6 flex justify-center">
                      <ArtVolume />
                    </div>
                  </div>
                </section>
              </Show>

              <Show when={lyricsEverOpened() || showLyrics()}>
                <section
                  class="-my-16 flex min-h-0 min-w-0 self-stretch max-md:my-0 transition-opacity duration-300"
                  classList={{
                    'animate-fade-in': showLyrics(),
                    hidden: !showLyrics(),
                  }}
                  aria-label="Lyrics"
                >
                  <LyricsPanel variant="full" />
                </section>
              </Show>
              <Show when={showQueue()}>
                <section class="flex min-h-0 animate-fade-in flex-col self-stretch" aria-label="Up Next">
                  <UpNext embedded />
                </section>
              </Show>
            </div>

            <button
              class={`${chrome} ${fades} bottom-5 left-5 aria-pressed:text-primary`}
              data-glint
              aria-label="Lyrics"
              aria-pressed={showLyrics()}
              onClick={() => togglePanel('lyrics')}
            >
              <Show when={showLyrics()} fallback={<LyricsIcon size={18} />}>
                <LyricsActiveIcon size={18} />
              </Show>
            </button>

            {/* Three dots, bottom right: the background (static / motion / video) and the Up Next list live inside. */}
            <div class={`absolute right-5 bottom-5 z-1 ${fades}`}>
              <PlayerMenu
                class={`${chrome.replace('absolute z-1', '')}`}
                showVolume={false}
                upNext={{ active: () => showQueue(), toggle: () => togglePanel('queue') }}
              />
            </div>
          </div>
        );
      }}
    </Show>
  );
}
