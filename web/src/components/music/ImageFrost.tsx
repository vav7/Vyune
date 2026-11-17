import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { proxiedImg } from '@/lib/api';
import { artworkForPaint } from '@/lib/artwork';
import { currentTier } from '@/lib/perf';

export const GRAIN = '';

interface Layer {
  url: string;
  id: number;
}

const CORNERS = [
  'radial-gradient(62% 72% at 10% 6%, {c} 0%, transparent 72%)',
  'radial-gradient(58% 68% at 94% 16%, {c} 0%, transparent 72%)',
  'radial-gradient(72% 62% at 82% 100%, {c} 0%, transparent 72%)',
  'radial-gradient(60% 62% at 6% 96%, {c} 0%, transparent 72%)',
];

/** The picture's dominant colours as soft pools of light, with the dim and the vignette folded into the same layer. */
function wash(palette: string[] | undefined, dim: number): string {
  const veil = `linear-gradient(180deg, rgba(6,6,10,${(dim * 0.7).toFixed(3)}) 0%, rgba(6,6,10,${(dim + 0.38).toFixed(3)}) 100%)`;
  if (!palette?.length) return veil;
  const pools = CORNERS.map((corner, index) => corner.replace('{c}', palette[index % palette.length]!));
  // The pools sit under the veil so the colour is kept while the page stays dark enough to read.
  return `${veil}, ${pools.join(', ')}`;
}

/**
 * A frosted picture drawn the cheap way: the artwork is painted once into a
 * tiny canvas with a small blur, and the browser's smooth upscaling does the
 * rest. There is no full-screen CSS blur, so scrolling and animation stay on
 * the compositor, and changing pictures is a plain opacity fade.
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
    // Once the new picture has faded in, the old one is released.
    const timer = window.setTimeout(() => setLayers((previous) => previous.slice(-1)), 1200);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <div class={`absolute inset-0 overflow-hidden bg-transparent ${props.class ?? ''}`} aria-hidden="true">
      <For each={layers()}>{(layer) => <FrostCanvas url={layer.url} />}</For>
      <Show when={currentTier() !== 'low' && (props.palette?.length ?? 0) > 0}>
        <ColorScatter palette={props.palette!} />
      </Show>
      <div class="absolute inset-0 transition-[background-image] duration-700" style={{ 'background-image': wash(props.palette, props.dim ?? 0.4) }} />
    </div>
  );
}

/** Slow, soft pools of the artwork's own colours drifting over the blur: colour scattering, on the compositor only. */
function ColorScatter(props: { palette: string[] }) {
  const blobs = () => props.palette.slice(0, 4);
  return (
    <div class="frost-scatter pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <For each={blobs()}>
        {(color, index) => (
          <span
            class="frost-blob"
            data-i={index()}
            style={{ 'background-image': `radial-gradient(closest-side, ${color} 0%, transparent 100%)` }}
          />
        )}
      </For>
    </div>
  );
}

function FrostCanvas(props: { url: string }) {
  let canvas!: HTMLCanvasElement;
  const [ready, setReady] = createSignal(false);
  const W = 960;
  const H = 540;

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
      // High-resolution multi-step bicubic downscale for silky smooth color transition
      let from: CanvasImageSource = image;
      let fw = image.naturalWidth;
      let fh = image.naturalHeight;
      while (fw > W * 2 && fh > H * 2) {
        const step = document.createElement('canvas');
        step.width = Math.max(W, Math.round(fw / 2));
        step.height = Math.max(H, Math.round(fh / 2));
        const sctx = step.getContext('2d');
        if (!sctx) return;
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(from, 0, 0, step.width, step.height);
        from = step;
        fw = step.width;
        fh = step.height;
      }
      // Cover-fit, oversized so the soft edges of the blur never show
      const cover = Math.max(W / fw, H / fh) * 1.2;
      const smoothW = 480;
      const smoothH = 270;
      const step = document.createElement('canvas');
      step.width = smoothW;
      step.height = smoothH;
      const sctx = step.getContext('2d');
      if (!sctx) return;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(from, (smoothW - (fw * cover * smoothW) / W) / 2, (smoothH - (fh * cover * smoothH) / H) / 2, (fw * cover * smoothW) / W, (fh * cover * smoothH) / H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(step, 0, 0, W, H);
      setReady(true);
    };
    image.src = proxiedImg(artworkForPaint(source, 720));
    onCleanup(() => {
      dead = true;
      image.onload = null;
    });
  });

  // High-fidelity Retina optical glass blur
  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      class={`absolute inset-0 size-full scale-[1.12] object-cover transition-opacity duration-[1100ms] ease-out [filter:blur(54px)_saturate(2.2)_contrast(1.05)_brightness(1.05)] ${ready() ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
