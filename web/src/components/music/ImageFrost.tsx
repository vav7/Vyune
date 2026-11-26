import { createEffect, createSignal, For, onCleanup } from 'solid-js';
import { proxiedImg } from '@/lib/api';
import { artworkForPaint } from '@/lib/artwork';

interface Layer {
  url: string;
  id: number;
}

/**
 * Smooth frosted artwork backdrop:
 * Draws once into a 640×360 canvas with offscreen blur (eliminates 128×72 pixelation)
 * and a single clean black veil (eliminates multi-gradient banding stripes).
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

  const veilAlpha = () => Math.min(0.85, Math.max(0.25, props.dim ?? 0.42));

  return (
    <div class={`absolute inset-0 overflow-hidden bg-transparent ${props.class ?? ''}`} aria-hidden="true">
      <For each={layers()}>{(layer) => <FrostCanvas url={layer.url} />}</For>
      <div
        class="absolute inset-0 transition-colors duration-700"
        style={{ 'background-color': `rgba(0, 0, 0, ${veilAlpha().toFixed(3)})` }}
      />
    </div>
  );
}

function FrostCanvas(props: { url: string }) {
  let canvas!: HTMLCanvasElement;
  const [ready, setReady] = createSignal(false);
  const W = 640;
  const H = 360;

  createEffect(() => {
    const el = canvas;
    const ctx = el?.getContext('2d', { alpha: false });
    if (!el || !ctx) return;
    const source = props.url;
    let dead = false;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (dead || !image.naturalWidth) return;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if ('filter' in ctx) {
        ctx.filter = 'blur(42px) saturate(1.85) brightness(1.02)';
      }
      const cover = Math.max(W / image.naturalWidth, H / image.naturalHeight) * 1.25;
      const dw = image.naturalWidth * cover;
      const dh = image.naturalHeight * cover;
      ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
      setReady(true);
    };
    image.src = proxiedImg(artworkForPaint(source, 544));
    onCleanup(() => {
      dead = true;
      image.onload = null;
    });
  });

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      class={`absolute inset-0 size-full scale-[1.06] object-cover transition-opacity duration-700 ease-out ${ready() ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
