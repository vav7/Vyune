import { createEffect, createSignal, For, onCleanup } from 'solid-js';
import { proxiedImg } from '@/lib/api';
import { artworkForPaint } from '@/lib/artwork';

interface Layer {
  url: string;
  id: number;
}

/**
 * Band-free GPU-blurred artwork backdrop:
 * Uses a tiny 120px artwork <img> promoted to its own GPU layer with a half-float
 * CSS blur filter, eliminating the 8-bit <canvas> contour scratches/banding.
 */
export function ImageFrost(props: { src: string | null; dim?: number; palette?: string[]; class?: string }) {
  const [layers, setLayers] = createSignal<Layer[]>([]);

  createEffect(() => {
    const source = props.src;
    if (!source) {
      setLayers([]);
      return;
    }
    setLayers((previous) =>
      previous.at(-1)?.url === source ? previous : [...previous, { url: source, id: Date.now() }].slice(-2),
    );
    const timer = window.setTimeout(() => setLayers((previous) => previous.slice(-1)), 950);
    onCleanup(() => window.clearTimeout(timer));
  });

  const veilAlpha = () => Math.min(0.78, Math.max(0.20, props.dim ?? 0.35));

  return (
    <div class={`absolute inset-0 overflow-hidden bg-transparent ${props.class ?? ''}`} aria-hidden="true">
      <For each={layers()}>{(layer) => <FrostLayer url={layer.url} />}</For>
      <div
        class="absolute inset-0 transition-colors duration-700"
        style={{ 'background-color': `rgba(0, 0, 0, ${veilAlpha().toFixed(3)})` }}
      />
    </div>
  );
}

function FrostLayer(props: { url: string }) {
  const [ready, setReady] = createSignal(false);

  return (
    <img
      src={proxiedImg(artworkForPaint(props.url, 240))}
      alt=""
      aria-hidden="true"
      decoding="async"
      onLoad={() => setReady(true)}
      class={`pointer-events-none absolute inset-0 size-full scale-[1.2] object-cover transition-opacity duration-700 ease-out will-change-[opacity] [filter:blur(48px)_saturate(1.45)] [transform:translate3d(0,0,0)_scale(1.2)] ${ready() ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
