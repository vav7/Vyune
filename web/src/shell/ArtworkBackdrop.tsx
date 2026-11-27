import { Show } from 'solid-js';
import { knownArtworkColor, useArtworkColor } from '@/lib/artworkColor';
import { ImageFrost } from '@/components/music/ImageFrost';

/**
 * Clean, band-free OLED player backdrop.
 * - Art / Motion modes: single smooth 640×360 ImageFrost layer (zero stacked radial/linear gradients = zero banding stripes).
 * - MV mode: pure OLED black (#050505) so 100% of GPU goes to crisp, zero-lag video playback.
 */
export function ArtworkBackdrop(props: {
  artworkUrl: string | null;
  fallbackUrl?: string | null;
  videoSrc?: string | null;
  motionVideo?: HTMLVideoElement | null;
  mode?: string;
  videoReady?: boolean;
}) {
  const measured = useArtworkColor(() => props.artworkUrl);
  const color = () => measured() ?? knownArtworkColor(props.fallbackUrl ?? null) ?? null;
  const isVideoMode = () => props.mode === 'mv' && props.videoReady === true;

  return (
    <div
      class="pointer-events-none absolute inset-0 -z-1 overflow-hidden bg-[#070708]"
      aria-hidden="true"
    >
      <Show when={!isVideoMode()}>
        <ImageFrost
          src={props.artworkUrl || props.fallbackUrl || null}
          palette={color()?.palette}
          dim={(color()?.lum ?? 0) > 0.6 ? 0.56 : 0.42}
          class="bg-transparent"
        />
      </Show>
    </div>
  );
}
