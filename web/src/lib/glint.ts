/**
 * Pointer light for `data-glint` elements (see styles/glass.css).
 *
 * One delegated listener for the whole app. While the mouse is over a glinting
 * element it writes that element's `--mx` / `--my`, once per frame; touch and
 * pen are ignored, so phones pay nothing.
 */
export function installGlint() {
  let target: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  let frame = 0;

  const paint = () => {
    frame = 0;
    if (!target) return;
    const box = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${x - box.left}px`);
    target.style.setProperty('--my', `${y - box.top}px`);
  };

  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      const hit = (event.target as Element | null)?.closest?.<HTMLElement>('[data-glint]') ?? null;
      if (!hit) return;
      target = hit;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    },
    { passive: true },
  );
}
