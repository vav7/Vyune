import { createEffect, createMemo, lazy, onCleanup, Show, Suspense } from 'solid-js';
import { PanelRight } from 'lucide-solid';
import { playerStore } from '@/store/player';
import { uiStore } from '@/store/ui';
import { UpNext } from './UpNext';

// Load the lyric panel on first open so the GSAP renderer stays out of the initial bundle.
const LyricsPanel = lazy(() => import('./LyricsPanel').then((m) => ({ default: m.LyricsPanel })));

/** Up Next / Lyrics glass panel (report §7). */
export function SidePanel() {
  let shell!: HTMLElement;

  // The panel keeps its place in the layout under the full-screen player, so
  // nothing slides or re-flows when the player closes. Only its lyrics stand
  // down while the player shows its own: one lyric engine running at a time.
  const panel = createMemo(() => uiStore.sidePanel);
  const lyricsLive = () => panel() === 'lyrics' && !playerStore.fullscreen;
  const float = () => uiStore.lyricsFloat;

  const floating = createMemo(() => panel() === 'lyrics' && !!float());

  const MARGIN = 8;
  /** Keep the whole card on screen: the viewport is the only bound it has. */
  const clamp = (x: number, y: number, width: number, height: number) => ({
    x: Math.round(Math.min(Math.max(MARGIN, x), Math.max(MARGIN, innerWidth - width - MARGIN))),
    y: Math.round(Math.min(Math.max(MARGIN, y), Math.max(MARGIN, innerHeight - height - MARGIN))),
  });

  // A window that shrinks, or a card resized past the edge, must not strand it off-screen.
  createEffect(() => {
    if (!floating()) return;
    const keep = () => {
      const at = float();
      if (!at || !shell) return;
      const box = shell.getBoundingClientRect();
      const next = clamp(at.x, at.y, box.width, box.height);
      if (next.x !== at.x || next.y !== at.y) uiStore.setLyricsFloat(next);
    };
    keep();
    const observer = new ResizeObserver(keep);
    observer.observe(shell);
    addEventListener('resize', keep);
    onCleanup(() => {
      observer.disconnect();
      removeEventListener('resize', keep);
    });
  });

  /**
   * Press and hold the grip to lift the lyrics out of the side panel; drag it
   * anywhere on screen. Once it is a window the grip drags at once, and a
   * double-click (or the dock button) puts it back. Positions are viewport
   * coordinates: the card is `fixed`, so the 300px column it came from neither
   * clips it nor limits where it can go.
   */
  const grab = (event: PointerEvent) => {
    const box = shell;
    // On a phone the panel is a full-screen sheet: there is nothing to detach it from.
    if (!box || event.button !== 0 || innerWidth < 640) return;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const rect = box.getBoundingClientRect();
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    let lifted = floating();
    const move = (e: PointerEvent) => {
      if (!lifted) return;
      const size = box.getBoundingClientRect();
      uiStore.setLyricsFloat(clamp(e.clientX - grabX, e.clientY - grabY, size.width, size.height));
    };
    const timer = floating()
      ? 0
      : window.setTimeout(() => {
          lifted = true;
          // The floating card is a fixed 400px window, not the docked column's width.
          uiStore.setLyricsFloat(clamp(rect.left - Math.max(0, 400 - rect.width), rect.top, 400, Math.min(640, innerHeight * 0.78)));
        }, 320);
    const end = () => {
      window.clearTimeout(timer);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    onCleanup(end);
  };

  return (
    <Show when={panel()} keyed>
      {(active) => (
        <aside
          ref={shell}
          class={
            floating()
              ? 'fixed z-[70] isolate flex h-[min(640px,78dvh)] min-h-[260px] w-[400px] min-w-[280px] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] resize flex-col overflow-hidden rounded-[14px] panel-glass shadow-[inset_0_1px_0_0_rgba(255,255,255,0.32),0_24px_60px_-18px_rgba(0,0,0,0.85)] animate-[fade-in_160ms_ease-out_both] [&::-webkit-resizer]:bg-transparent max-sm:inset-0 max-sm:h-auto max-sm:w-full max-sm:max-w-none max-sm:resize-none max-sm:rounded-none max-sm:border-0'
              : 'absolute top-[3px] bottom-[3px] right-[3px] z-(--z-web-chrome) isolate flex w-[calc(var(--side-panel-width)-6px)] animate-slide-in flex-col overflow-hidden rounded-[14px] panel-glass max-sm:inset-0 max-sm:w-full max-sm:rounded-none max-sm:border-0'
          }
          aria-label={active === 'up-next' ? 'Up Next' : 'Lyrics'}
          style={floating() && float() && innerWidth >= 640 ? { left: `${float()!.x}px`, top: `${float()!.y}px` } : undefined}
        >
          <Show when={active === 'lyrics'}>
            <div
              role="separator"
              aria-label="Hold and drag to move the lyrics"
              title={floating() ? 'Drag to move · double-click to dock' : 'Hold and drag to detach'}
              class="absolute inset-x-0 top-0 z-[3] grid h-7 cursor-grab touch-none place-items-center active:cursor-grabbing"
              onPointerDown={grab}
              onDblClick={() => uiStore.setLyricsFloat(null)}
            >
              <span class="h-1 w-10 rounded-full bg-white/30" />
            </div>
            <Show when={floating()}>
              <button
                type="button"
                class="absolute right-2 top-1 z-[4] grid size-6 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/15 hover:text-white max-sm:hidden"
                aria-label="Dock lyrics back into the side panel"
                title="Dock lyrics"
                onClick={() => uiStore.setLyricsFloat(null)}
              >
                <PanelRight size={14} />
              </button>
            </Show>
          </Show>
          <div class="relative z-[1] flex min-h-0 flex-1 flex-col">
            <Show when={active === 'up-next'} fallback={
              <Show when={lyricsLive()}>
                <Suspense fallback={<div class="flex flex-1 items-center justify-center type-callout text-secondary">Loading lyrics…</div>}>
                  <LyricsPanel variant="panel" />
                </Suspense>
              </Show>
            }>
              <UpNext />
            </Show>
          </div>
        </aside>
      )}
    </Show>
  );
}
