import { createEffect, createSignal, onCleanup } from 'solid-js';
import { proxiedImg } from './api';
import { sizedArtwork } from './artwork';

export interface ArtworkColor {
  /** The background colour behind the page ("joe colour"). */
  background: string;
  /** Whether text on it should be light (a dark colour) or dark. */
  dark: boolean;
  /** How light the picture itself is (0–1): a pale poster is toned down, a dark one left rich. */
  lum?: number;
  /** Up to four deep glass tones, one per dominant hue of the picture. */
  palette?: string[];
}

const cache = new Map<string, ArtworkColor>();
const pending = new Map<string, Promise<ArtworkColor>>();
const STORAGE_PREFIX = 'vyune-artwork-color-v4:';

/** Every size of one picture is one colour: key on the 16px copy that is measured. */
const colorKey = (url: string) => sizedArtwork(url, 16);

function readCached(rawUrl: string): ArtworkColor | null {
  const url = colorKey(rawUrl);
  const memory = cache.get(url);
  if (memory) return memory;
  try {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}${url}`);
    if (!saved) return null;
    const value = JSON.parse(saved) as { background?: unknown; dark?: unknown; lum?: unknown; palette?: unknown };
    if (typeof value.background !== 'string' || !/^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/.test(value.background) || typeof value.dark !== 'boolean') return null;
    const color = { background: value.background, dark: value.dark, lum: typeof value.lum === 'number' ? value.lum : undefined, palette: Array.isArray(value.palette) ? value.palette.filter((c): c is string => typeof c === 'string') : undefined };
    cache.set(url, color);
    return color;
  } catch {
    return null;
  }
}

function writeCached(rawUrl: string, color: ArtworkColor) {
  const url = colorKey(rawUrl);
  cache.set(url, color);
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${url}`, JSON.stringify(color));
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));
    // Palette entries are tiny; keep the per-browser cache bounded.
    while (keys.length > 160) localStorage.removeItem(keys.shift()!);
  } catch {
    // Private browsing or a full storage quota can disable persistent cache.
  }
}

/**
 * The artwork's edge/corner colour, drawn from a tiny copy of it on a canvas.
 *
 * Apple's artist pages tint the whole page from the banner's *edges* — the
 * centre is usually the subject (the artist's face), while the corners carry
 * the ambient scene colour. We downscale to 16x16 and sample the four 4x4
 * corner blocks (64 pixels each) instead of averaging the whole frame. The
 * result is cached in memory and localStorage so repeat visits are instant:
 * the colour is available synchronously during the first render, before any
 * image decodes. A returning visitor never sees a flash of the wrong tint.
 * Read through the server's image proxy so the canvas stays readable for
 * every CDN the catalogue answers with (i.ytimg and saavncdn send no CORS
 * headers of their own).
 */
/** One hue bucket's average, turned into a deep, saturated glass tone. */
function deepTone(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === r / 255) hue = (((g - b) / 255 / chroma) % 6 + 6) % 6;
    else if (max === g / 255) hue = (b - r) / 255 / chroma + 2;
    else hue = (r - g) / 255 / chroma + 4;
    hue *= 60;
  }
  const rawSat = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  const sat = Math.min(0.9, rawSat * 1.2 + 0.12);
  const light = Math.min(0.34, Math.max(0.16, l * 0.7));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255);
  return `rgb(${to(r1)}, ${to(g1)}, ${to(b1)})`;
}

/** Every colour of the picture, not just its edges: the four strongest hues, as deep tones. */
function paletteOf(data: Uint8ClampedArray): string[] {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const chroma = (max - min) / 255;
    if (chroma < 0.12 || l < 0.08 || l > 0.94) continue; // greys, blacks and whites carry no hue
    let hue = 0;
    if (max === r) hue = (((g - b) / (max - min)) % 6 + 6) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    const bucket = buckets[Math.min(11, Math.floor((hue * 60) / 30))]!;
    const weight = chroma * (1 - Math.abs(2 * l - 1) * 0.5);
    bucket.w += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }
  return buckets
    .filter((bucket) => bucket.w > 0.6)
    .sort((a, b) => b.w - a.w)
    .slice(0, 4)
    .map((bucket) => deepTone(bucket.r / bucket.w, bucket.g / bucket.w, bucket.b / bucket.w));
}

async function measure(url: string): Promise<ArtworkColor> {
  const image = new Image();
  image.decoding = 'async';
  // 16px is enough for four 4x4 corner samples. The download is tiny.
  image.src = proxiedImg(sizedArtwork(url, 32));
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 32, 32);
  const full = context.getImageData(0, 0, 32, 32).data;
  const palette = paletteOf(full);
  context.drawImage(image, 0, 0, 16, 16);
  const { data } = context.getImageData(0, 0, 16, 16);

  // Sample the four 4x4 corners: top-left, top-right, bottom-left, bottom-right.
  // This is the "edge colour" Apple uses — the centre (the face) is ignored.
  let r = 0, g = 0, b = 0;
  const cornerSize = 4;
  const corners = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 0, y: 12 },
    { x: 12, y: 12 },
  ];
  for (const { x, y } of corners) {
    for (let dy = 0; dy < cornerSize; dy++) {
      for (let dx = 0; dx < cornerSize; dx++) {
        const px = (x + dx);
        const py = (y + dy);
        const i = (py * 16 + px) * 4;
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
      }
    }
  }
  const n = corners.length * cornerSize * cornerSize; // 64
  [r, g, b] = [r / n, g / n, b / n];

  // The page is always dark. A pale poster is scattered into a deep tone of
  // its own hue (lightness held low), while a dark one keeps its richness.
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === r / 255) hue = (((g - b) / 255 / chroma) % 6 + 6) % 6;
    else if (max === g / 255) hue = (b - r) / 255 / chroma + 2;
    else hue = (r - g) / 255 / chroma + 4;
    hue *= 60;
  }
  const rawSat = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  // Greys stay grey; colours gain a touch so a deep tone still reads as the poster's.
  const sat = rawSat < 0.06 ? rawSat : Math.min(0.88, rawSat * 1.15 + 0.08);
  // Deep but alive: a colourful poster keeps its hue at a rich mid-dark; a pale
  // one is brought down to the same depth rather than left to glare.
  const light = Math.min(0.3, Math.max(0.13, lightness * 0.62));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return { background: `rgb(${to255(r1)}, ${to255(g1)}, ${to255(b1)})`, dark: true, lum: lightness, palette: palette.length ? palette : undefined };
}

function measureOnce(url: string): Promise<ArtworkColor> {
  const existing = pending.get(url);
  if (existing) return existing;
  const task = measure(url).then((color) => {
    writeCached(url, color);
    return color;
  }).finally(() => pending.delete(url));
  pending.set(url, task);
  return task;
}

/**
 * The artwork's colour, measured and reactive.
 *
 * Returns an **accessor**: call it where you use it (`color()?.background`).
 * A React hook returned a value that the component re-read on every render;
 * in Solid the component body runs once, so the colour has to stay a function
 * for the page to repaint when the measurement lands.
 *
 * The destination's cached value is read synchronously, so changing albums or
 * playlists never paints one frame with the previous artwork's tint.
 */
export function useArtworkColor(
  url: string | null | undefined | (() => string | null | undefined),
): () => ArtworkColor | null {
  const read = () => (typeof url === 'function' ? url() : url);
  const [measured, setMeasured] = createSignal<{ url: string; color: ArtworkColor } | null>(null);

  const current = (): ArtworkColor | null => {
    const target = read();
    if (!target) return null;
    const cached = readCached(target);
    if (cached) return cached;
    const hit = measured();
    return hit && hit.url === target ? hit.color : null;
  };

  createEffect(() => {
    const target = read();
    if (!target) return;
    if (readCached(target)) return;
    let live = true;
    measureOnce(target)
      .then((value) => {
        if (live) setMeasured({ url: target, color: value });
      })
      .catch(() => {
        // An unreadable image leaves the page in its normal colours.
      });
    onCleanup(() => {
      live = false;
    });
  });

  return current;
}

/**
 * Measure a picture ahead of the click — on hover, and the moment a song is
 * queued — so the player already knows the colour when it opens. Cheap and
 * idempotent: a known picture costs nothing.
 */
export function prewarmArtworkColor(url: string | null | undefined) {
  if (!url || readCached(url)) return;
  void measureOnce(url).catch(() => undefined);
}

/** The colour the player showed last: what it fades *from*, never a default blue. */
let lastShown: ArtworkColor | null = null;
export const lastArtworkColor = () => lastShown;
export const rememberArtworkColor = (color: ArtworkColor | null) => {
  if (color) lastShown = color;
};

/** The colour of a picture if it is already known, read synchronously. */
export const knownArtworkColor = (url: string | null | undefined) => (url ? readCached(url) : null);
