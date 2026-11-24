/* artwork.ts — size-snapping for the image CDNs the catalogue answers with.
 *
 * The square sizes YouTube Music's own pages request: googleusercontent
 * resizes on demand and answers bursts of uncached sizes with 429, so
 * snapping to the standard ladder keeps requests on cached variants.
 * JioSaavn's CDN works the same way with its 50x50/150x150/500x500 tokens.
 */

const SQUARE_SIZES = [60, 120, 226, 544, 1200];

const RESIZABLE = /googleusercontent\.com|ggpht\.com/;
const SAAVN = /saavncdn\.com/;
const YTIMG = /ytimg\.com/i;
const MZSTATIC = /mzstatic\.com/i;

export const isVideoThumbnail = (url?: string | null) => !!url && /(?:^|\/\/)(?:i\d*\.)?ytimg\.com\//i.test(url);

/**
 * Asks the image CDN for a size close to what's displayed: the smallest
 * standard size at least as large as the rendered pixels (× DPR, capped at 3).
 * Upgrades YouTube video thumbnails and JioSaavn covers to their highest available resolution.
 */
export function sizedArtwork(url: string | null | undefined, cssPx: number, aspect = 1): string {
  if (!url) return '';
  if (SAAVN.test(url)) {
    return saavnAtPixels(url, 500);
  }
  if (MZSTATIC.test(url)) {
    const size = cssPx >= 250 ? 1200 : 600;
    return url
      .replace('{w}x{h}', `${size}x${size}`)
      .replace(/\d+x\d+(bb|cc|SC)?\./, `${size}x${size}$1.`);
  }
  if (YTIMG.test(url) && cssPx >= 280) {
    // Keep hqdefault as reliable high quality (480x360), avoiding 404s/deleted placeholder icons from missing maxresdefault
    return url.replace(/(?:mqdefault|default|sddefault)\.(jpg|webp)/i, 'hqdefault.$1');
  }
  if (!RESIZABLE.test(url) || Math.abs(aspect - 1) > 0.01) return url;
  const dpr = Math.min(typeof window === 'undefined' ? 2 : window.devicePixelRatio || 1, 3);
  const needed = cssPx * dpr;
  const size = SQUARE_SIZES.find((s) => s >= needed) ?? SQUARE_SIZES[SQUARE_SIZES.length - 1]!;
  return artworkAtPixels(url, size);
}

/** A square artwork at an exact pixel size (media session, canvases). */
export function artworkAtPixels(url: string, px: number): string {
  if (!RESIZABLE.test(url)) return url;
  const base = url.split(/[=?]/)[0];
  return `${base}=w${px}-h${px}-l90-rj`;
}

/** A JioSaavn CDN artwork at one of its ladder sizes. */
export function saavnAtPixels(url: string, px = 500): string {
  if (!url) return '';
  return url
    .replace(/^http:\/\//i, 'https://')
    .replace(/[-_](?:50x50|150x150|500x500)(\.\w+)?$/, `-${px}x${px}.jpg`);
}

/**
 * The artwork at the largest standard size that is still small enough to
 * paint with.
 *
 * Two things paint with the sleeve rather than showing it: the blurred
 * backdrop and the colour palette the mesh is built from.
 */
export function artworkForPaint(url: string | null | undefined, px = 544): string {
  if (!url) return '';
  if (SAAVN.test(url)) return saavnAtPixels(url, px >= 500 ? 500 : px >= 150 ? 150 : 50);
  if (!RESIZABLE.test(url)) return url;
  const size = px >= 1200 ? 1200 : px >= 544 ? 544 : px >= 226 ? 226 : 120;
  return artworkAtPixels(url, size);
}
