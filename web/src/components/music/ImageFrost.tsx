import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { proxiedImg } from '@/lib/api';
import { artworkForPaint } from '@/lib/artwork';
import { currentTier } from '@/lib/perf';

/** Kept for reference only: nothing paints grain any more, the blur is smooth by itself. */
export const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

let grain = '';
/** A 128px tile of fine noise, generated once and reused: no SVG filter, no per-frame work. */
function frostGrain(): string {
  if (grain) return grain;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = c.toDataURL('image/png');
  return grain;
}

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
    <div class={`absolute inset-0 overflow-hidden bg-[#07070b] ${props.class ?? ''}`} aria-hidden="true">
      <For each={layers()}>{(layer) => <FrostCanvas url={layer.url} />}</For>
      <Show when={currentTier() !== 'low' && (props.palette?.length ?? 0) > 0}>
        <ColorScatter palette={props.palette!} />
      </Show>
      <div class="absolute inset-0 transition-[background-image] duration-700" style={{ 'background-image': wash(props.palette, props.dim ?? 0.4) }} />
      {/* The frost: a still, fine grain (drawn once, never animated) that dithers the gradient so it can never band. */}
      <div class="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ 'background-image': `url(${frostGrain()})`, 'background-size': '128px 128px' }} />
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
  const W = 320;
  const H = 180;

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
      // Halve the picture step by step: every step averages neighbours, so detail melts away
      // into a clean colour field (a single big jump keeps noise and stretches it into blocks).
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
      // Cover-fit, oversized so the soft edges of the blur never show. The picture is first melted
      // down to a 48x27 colour field and stretched back up: bilinear upscaling of so few samples is
      // a perfectly smooth gradient, so the blur has no pixel edges left to crack or band.
      const cover = Math.max(W / fw, H / fh) * 1.25;
      const tiny = document.createElement('canvas');
      tiny.width = 48;
      tiny.height = 27;
      const tctx = tiny.getContext('2d');
      if (!tctx) return;
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(from, (48 - (fw * cover * 48) / W) / 2, (27 - (fh * cover * 27) / H) / 2, (fw * cover * 48) / W, (fh * cover * 27) / H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tiny, 0, 0, W, H);
      setReady(true);
    };
    image.src = proxiedImg(artworkForPaint(source, 544));
    onCleanup(() => {
      dead = true;
      image.onload = null;
    });
  });

  // The final softness is one Gaussian blur on a layer that never changes after it fades in, so the
  // browser rasterises it once; the 320x180 source keeps the gradients silky, with no blocks for the blur to smear.
  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      class={`absolute inset-0 size-full scale-[1.12] object-cover transition-opacity duration-[1100ms] ease-out [filter:blur(30px)_saturate(2.2)_contrast(1.08)_brightness(1.06)] ${ready() ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
