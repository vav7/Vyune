import type { JSX } from 'solid-js';

type CSSProperties = JSX.CSSProperties;
type Dimension = string | number;

interface BlockProps {
  width?: Dimension;
  height?: Dimension;
  radius?: Dimension;
  aspectRatio?: CSSProperties['aspect-ratio'];
  class?: string;
  style?: CSSProperties;
}

// A soft highlight sweeping left to right; still under reduced motion. The sweep animates
// `transform` from the -100% it starts at, so it is set as a transform, not a translate.
const block =
  'relative shrink-0 overflow-hidden rounded-[4px] bg-skeleton after:absolute after:inset-0 after:transform-[translateX(-100%)] after:animate-shimmer after:bg-[linear-gradient(90deg,transparent_0,var(--skeleton-shimmer)_50%,transparent_100%)] motion-reduce:after:hidden motion-reduce:after:animate-none';

const cssDimension = (value?: Dimension) => typeof value === 'number' ? `${value}px` : value;

/** A placeholder box with a shimmer. Purely decorative, so hidden from AT. */
export function SkeletonBlock({ width, height, radius, aspectRatio, class: className, style }: BlockProps) {
  return (
    <div
      aria-hidden="true"
      class={className ? `${block} ${className}` : block}
      style={{ width: cssDimension(width), height: cssDimension(height), 'border-radius': cssDimension(radius), 'aspect-ratio': aspectRatio, ...style }}
    />
  );
}

interface LineProps {
  /** The text style's line height, so the row is exactly as tall as the text it stands in for. */
  lineHeight: number;
  /** Roughly the font size: the bar's thickness. */
  fontSize: number;
  width: Dimension;
  style?: CSSProperties;
}

/** A single line of text in waiting. */
export function SkeletonLine({ lineHeight, fontSize, width, style }: LineProps) {
  return (
    <div aria-hidden="true" class="flex items-center" style={{ height: `${lineHeight}px`, ...style }}>
      <SkeletonBlock width={width} height={`${Math.round(fontSize * 0.75)}px`} radius="3px" />
    </div>
  );
}
