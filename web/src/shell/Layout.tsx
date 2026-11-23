/* Layout.tsx — the app frame (report §1): the three-column grid, the glass
 * sidebar, the scrolling page, the floating player pill, the side panel, the
 * phone's top bar and mini player, and the toast.
 *
 * The frame is a real grid — sidebar | page | side panel — the way Apple's own
 * music app is laid out. The third column exists only while the panel is
 * open, and below 1180px the panel floats over the page instead of taking a
 * column of its own.
 */

import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { useLocation, type RouteSectionProps } from '@solidjs/router';
import { CommandPalette } from '@/components/CommandPalette';
import { playerStore } from '@/store/player';
import { uiStore } from '@/store/ui';
import { PanelLeft } from 'lucide-solid';
import { ImageFrost } from '@/components/music/ImageFrost';
import { pageArtStore } from '@/lib/pageArt';
import { useWarmLyrics } from '@/lib/lyricsWarm';
import { AppBackground } from '@/components/ui/glass/AppBackground';
import { MobileTopBar } from './MobileTopBar';
import { MiniPlayer, PlayerBar } from './PlayerBar';
import { SidePanel } from './SidePanel';
import { Sidebar } from './Sidebar';

// The full-screen player is heavy, so it is its own chunk. The chunk is fetched
// as soon as there is a song and the browser is idle, so the first open never
// waits on the network.
//
// It is deliberately not `lazy()` inside a <Suspense>: a Suspense boundary
// freezes its subtree (effects and all) until every resource inside settles,
// and the player reads queries. Measured, that held the sheet back for about
// two seconds before it popped in. Loaded into a signal instead, it mounts
// the moment the module is there.
type PlayerComponent = typeof import('./FullScreenPlayer').FullScreenPlayer;
const loadFullScreenPlayer = () => import('./FullScreenPlayer');
const whenIdle = (task: () => void) =>
  typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(task, { timeout: 4000 })
    : window.setTimeout(task, 1500);

function Toast() {
  return (
    <div class={`toast-pill${playerStore.toast ? ' show' : ''}`} role="status" aria-live="polite">
      {playerStore.toast ?? ''}
    </div>
  );
}

/** The page's frosted backdrop: the open page's artwork, drawn once into a tiny canvas. */
function PageFrost() {
  return (
    <Show when={pageArtStore.url}>
      {(url) => (
        <div class="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <ImageFrost
            src={url()}
            palette={pageArtStore.palette}
            dim={pageArtStore.dim ?? (pageArtStore.lum > 0.6 ? 0.6 : 0.42)}
          />
        </div>
      )}
    </Show>
  );
}

// Pure transparent baseline: colors only bloom when song artwork is extracted
const AMBIENT = ['transparent', 'transparent', 'transparent', 'transparent'];

export function Layout(props: RouteSectionProps) {
  const sidebarHidden = () => uiStore.sidebarHidden;
  useWarmLyrics();
  const location = useLocation();
  const pathname = () => location.pathname;

  createEffect(() => {
    document.documentElement.dataset.sidebar = sidebarHidden() ? 'hidden' : 'shown';
  });

  // The frame's columns follow the side panel alone. The full-screen player is
  // an overlay: re-laying the page out under it made it jump the moment it closed.
  createEffect(() => {
    // A lyrics card that has been pulled out floats over the page: it takes no column.
    const docked = uiStore.sidePanel && !(uiStore.sidePanel === 'lyrics' && uiStore.lyricsFloat);
    document.documentElement.dataset.panel = docked ? 'open' : 'closed';
  });

  // Mounted while the player is open and for the length of its exit animation.
  const [playerMounted, setPlayerMounted] = createSignal(false);
  const [PlayerView, setPlayerView] = createSignal<PlayerComponent>();
  createEffect(() => {
    if (!playerStore.fullscreen) return;
    setPlayerMounted(true);
    void loadFullScreenPlayer().then((m) => setPlayerView(() => m.FullScreenPlayer));
  });
  createEffect(() => {
    if (!playerStore.current) setPlayerMounted(false);
  });
  createEffect(() => {
    if (playerStore.current) whenIdle(() => void loadFullScreenPlayer());
  });

  // A navigation starts its page at the top; the tint transitions from there.
  createEffect(() => {
    const path = pathname();
    void path;
    const page = document.getElementById('scrollable-page');
    if (page) page.scrollTop = 0;
  });

  onCleanup(() => {
    delete document.documentElement.dataset.sidebar;
    delete document.documentElement.dataset.panel;
  });

  return (
    <div class="mc-frame">
      <AppBackground />
      <div
        class="mc-ambient"
        aria-hidden="true"
        style={{
          '--amb1': pageArtStore.palette?.[0] ?? AMBIENT[0],
          '--amb2': pageArtStore.palette?.[1] ?? AMBIENT[1],
          '--amb3': pageArtStore.palette?.[2] ?? AMBIENT[2],
          '--amb4': pageArtStore.palette?.[3] ?? pageArtStore.palette?.[0] ?? AMBIENT[3],
        }}
      />
      {/* The side panel slides in from beyond the right edge; never let it scroll the page. */}
      <div class="mc-col-sidebar">
        <Sidebar data-sidebar />
        <button
          type="button"
          aria-label={sidebarHidden() ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarHidden() ? 'Show sidebar' : 'Hide sidebar'}
          class="absolute top-4 left-4 z-[65] grid size-9 place-items-center rounded-full border border-white/20 bg-black/40 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_24px_rgba(0,0,0,0.5)] [backdrop-filter:blur(24px)_saturate(1.8)] transition-[background-color,transform,left] duration-300 ease-out hover:bg-black/60 hover:text-white active:scale-90 max-sm:hidden data-[shown=true]:left-[calc(var(--web-navigation-width)+4px)]"
          data-shown={!sidebarHidden()}
          onClick={() => uiStore.toggleSidebar()}
        >
          <PanelLeft size={17} />
        </button>
        <MobileTopBar />
      </div>

      {/* The page scrolls under the fixed sidebar and the floating player. */}
      <div class="mc-col-page relative h-full min-h-0 overflow-hidden">
        <PageFrost />
        <main
          id="scrollable-page"
          class="relative z-[1] isolate size-full overflow-x-hidden overflow-y-auto overscroll-y-contain [scroll-behavior:auto] [-webkit-overflow-scrolling:touch] will-change-[scroll-position] transform-gpu data-tint:bg-(--page-tint) data-tint:transition-[background-color] data-tint:duration-300 data-tint:ease-out max-sm:pt-(--mobile-top-bar-height)"
        >
          {/* Clears the floating pill: its height, its offset, and some air. */}
          <div class="relative z-[1] min-h-full pb-[calc(var(--player-pill-height)+var(--player-bottom-offset)+40px)] max-sm:pb-[calc(var(--mini-player-height)+24px)]">
            {props.children}
          </div>
        </main>
      </div>

      {/* The third column: the side panel, when it is open. */}
      <div class="mc-col-panel">
        <SidePanel />
      </div>

      <Portal>
        <Show when={!playerStore.fullscreen}>
          <div class="mc-col-chrome" style={{ 'z-index': '9950' }}>
            <PlayerBar data-player-pill />
            <MiniPlayer />
          </div>
        </Show>
      </Portal>

      <Show when={playerMounted() && PlayerView()}>
        {(view) => <Dynamic component={view()} onExited={() => !playerStore.fullscreen && setPlayerMounted(false)} />}
      </Show>
      <Toast />
      <CommandPalette />
    </div>
  );
}
