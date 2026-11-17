import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { proxiedImg } from '@/lib/api';
import { artworkForPaint } from '@/lib/artwork';

export const GRAIN = '';

interface Layer {
  url: string;
  id: number;
}

/**
 * Glass made of the whole album cover.
 *
 * The cover is painted once into a tiny canvas — twice, the second pass turned
 * a quarter and laid over the first in `overlay` — and blurred there, so the
 * browser's smooth upscale finishes a very soft, very deep blur that carries
 * every colour of the picture rather than one tint. Over it: a dark veil so
 * white text stays legible, a light sheen from above, a bright specular edge
 * and fine grain. The canvas drifts slowly on the compositor, and a new cover
 * dissolves in over the old one. Nothing here repaints after the first frame.
 */
export function CoverGlass(props: {
  src: string | null | undefined;
  class?: string;
  veil?: number;
  fade?: 'bottom' | 'top';
}) {
  const [layers, setLayers] = createSignal<Layer[]>([]);
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const src = props.src;
    if (!src) {
      setLayers([]);
      return;
    }
    setLayers((previous) => (previous.at(-1)?.url === src ? previous : [...previous, { url: src, id: Date.now() }].slice(-2)));
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => setLayers((previous) => previous.slice(-1)), 1400);
  });

  onCleanup(() => {
    if (fadeTimer) clearTimeout(fadeTimer);
  });

  const mask = () => props.fade
    ? `linear-gradient(${props.fade === 'bottom' ? '0deg' : '180deg'}, #000 0%, #000 22%, transparent 88%)`
    : undefined;

  const veil = () => props.veil ?? 0.3;

  return (
    <Show when={props.src && layers().length > 0}>
      <div
        class={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-700 ease-out ${props.class ?? ''}`}
        style={mask() ? { '-webkit-mask-image': mask(), 'mask-image': mask() } : undefined}
        aria-hidden="true"
      >
        <For each={layers()}>
          {(layer) => <GlassCanvas url={layer.url} />}
        </For>
        <div class="absolute inset-0" style={{ background: `rgba(8,8,14,${veil()})` }} />
        <div class="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_0%,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.02)_50%,transparent_80%),linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(0,0,0,0.2)_100%)]" />
        <div class="absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_0_0_1px_rgba(255,255,255,0.14),inset_0_-18px_36px_-18px_rgba(0,0,0,0.55)]" />
      </div>
    </Show>
  );
}

function GlassCanvas(props: { url: string }) {
  let canvasRef: HTMLCanvasElement | undefined;
  const [ready, setReady] = createSignal(false);

  createEffect(() => {
    const el = canvasRef;
    const ctx = el?.getContext('2d', { alpha: false });
    if (!el || !ctx) return;
    let dead = false;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (dead || !image.naturalWidth) return;
      const { width, height } = el;
      const cover = (zoom: number) => Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
      // High-res optical glass filter pass
      try {
        ctx.filter = 'blur(16px) saturate(1.8) brightness(1.02)';
      } catch {
        // fallback
      }
      let scale = cover(1.75);
      ctx.drawImage(image, (width - image.naturalWidth * scale) / 2, (height - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      // Second pass, rotated: mesh of vibrant optical refraction
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.globalCompositeOperation = 'overlay';
      ctx.translate(width / 2, height / 2);
      ctx.rotate(Math.PI / 2);
      scale = cover(2.5);
      ctx.drawImage(image, (-image.naturalWidth * scale) / 2, (-image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      ctx.restore();
      setReady(true);
    };
    image.src = proxiedImg(artworkForPaint(props.url, 720));
    onCleanup(() => {
      dead = true;
      image.onload = null;
    });
  });

  return (
    <canvas
      ref={canvasRef}
      width={960}
      height={640}
      class={`absolute inset-0 size-full origin-center animate-[glass-drift_32s_ease-in-out_infinite_alternate] object-cover transition-opacity duration-[1100ms] ease-out ${ready() ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
