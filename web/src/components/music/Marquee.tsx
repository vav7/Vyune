import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';

/**
 * One line of text that never truncates with an ellipsis. When it fits it simply sits there; when it
 * does not, it scrolls right to left in a seamless loop (a second copy follows the first), pausing
 * briefly at the start so the beginning can be read. `render` is called once per copy, so it can
 * return links as well as plain text.
 */
export function Marquee(props: { render: () => JSX.Element; class?: string; speed?: number }) {
  let box!: HTMLDivElement;
  let track!: HTMLDivElement;
  let first!: HTMLSpanElement;
  const [over, setOver] = createSignal(false);
  const GAP = 48;

  const measure = () => {
    if (!box || !first) return;
    const width = first.offsetWidth;
    const overflow = width > box.clientWidth + 1;
    setOver(overflow);
    if (!overflow) return;
    track.style.setProperty('--mq-dist', `${width + GAP}px`);
    track.style.setProperty('--mq-dur', `${((width + GAP) / (props.speed ?? 36)).toFixed(2)}s`);
  };

  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(first);
    void document.fonts?.ready.then(measure);
    measure();
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={box} class={`mq min-w-0 ${props.class ?? ''}`} data-over={over() || undefined}>
      <div ref={track} class="mq-track">
        <span ref={first} class="mq-item">
          {props.render()}
        </span>
        <Show when={over()}>
          <span class="mq-item" aria-hidden="true">
            {props.render()}
          </span>
        </Show>
      </div>
    </div>
  );
}
