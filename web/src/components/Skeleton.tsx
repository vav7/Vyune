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

// Refined optical glass placeholder box with subtle crystalline sheen.
const block = 'relative shrink-0 overflow-hidden rounded-[10px] bg-white/[0.05] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] animate-pulse';

const cssDimension = (value?: Dimension) => typeof value === 'number' ? `${value}px` : value;

/** A placeholder box with a shimmer. Purely decorative, so hidden from AT. */
export function SkeletonBlock(props: BlockProps) {
  return (
    <div
      aria-hidden="true"
      class={props.class ? `${block} ${props.class}` : block}
      style={{
        width: cssDimension(props.width),
        height: cssDimension(props.height),
        'border-radius': cssDimension(props.radius),
        'aspect-ratio': props.aspectRatio,
        ...props.style,
      }}
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
export function SkeletonLine(props: LineProps) {
  return (
    <div aria-hidden="true" class="flex items-center" style={{ height: `${props.lineHeight}px`, ...props.style }}>
      <SkeletonBlock width={props.width} height={`${Math.round(props.fontSize * 0.75)}px`} radius="3px" />
    </div>
  );
}
