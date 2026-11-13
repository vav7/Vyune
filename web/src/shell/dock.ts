/** A pointer event whose target is the element the handler is bound to. */
export type DockPointerEvent = PointerEvent & { currentTarget: HTMLElement };

/** The right edge of the sidebar: where a dragged player counts as "thrown into" it. */
const sidebarRight = () => document.querySelector('[data-sidebar]')?.getBoundingClientRect().right ?? 0;

/**
 * Drag the player by its grip. The body follows the pointer; while it is over
 * the sidebar the sidebar lights up (`data-dock-hover`). On release,
 * `onDrop(overSidebar)` decides where it lands.
 */
export function startDockDrag(event: DockPointerEvent, body: HTMLElement | null, onDrop: (overSidebar: boolean) => void) {
  if (!body || event.button !== 0) return;
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;

  const move = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 8) return;
    moved = true;
    body.style.transition = 'none';
    body.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(0.97)`;
    body.style.opacity = '0.92';
    body.style.zIndex = '90';
    document.documentElement.dataset.dockHover = e.clientX < sidebarRight() ? 'sidebar' : 'free';
  };
  const end = (e: PointerEvent) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    body.style.transition = '';
    body.style.transform = '';
    body.style.opacity = '';
    body.style.zIndex = '';
    delete document.documentElement.dataset.dockHover;
    if (moved) onDrop(e.clientX < sidebarRight());
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
