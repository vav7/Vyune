import { createEffect, Show } from 'solid-js';
import { knownArtworkColor, lastArtworkColor, rememberArtworkColor, useArtworkColor } from '@/lib/artworkColor';
import { ImageFrost } from '@/components/music/ImageFrost';
import { MotionFrost } from '@/components/music/MotionFrost';
import type { ArtMode } from '@/store/artMode';

/**
 * The player's backdrop:
 * - Art Mode: Pure frosted artwork with static ambient lighting.
 * - Visualizer & MV Mode: Stays in frosted artwork ambient mode while video buffers (zero black flash),
 *   then smoothly cross-fades into the playing video with modern crystalline liquid glass transparent blur.
 */
export function ArtworkBackdrop(props: {
  artworkUrl: string | null;
  /** A picture whose colour is already known (the queued thumbnail). */
  fallbackUrl?: string | null;
  motionVideo?: HTMLVideoElement | null;
  mode?: ArtMode;
  videoReady?: boolean;
}) {
  const measured = useArtworkColor(() => props.artworkUrl);
  const color = () => measured() ?? knownArtworkColor(props.fallbackUrl ?? null) ?? null;

  createEffect(() => {
    rememberArtworkColor(color());
  });

  // Only activate video background when in video mode AND video is actually buffered & ready
  const isVideoMode = () =>
    (props.mode === 'visualiser' || props.mode === 'mv') && props.videoReady === true && !!props.motionVideo;

  const backgroundColor = () => {
    const base = color() ?? lastArtworkColor();
    return base ? `color-mix(in srgb, ${base.background} 70%, #07070b 30%)` : '#07070b';
  };

  return (
    <div
      class="absolute inset-0 -z-1 overflow-hidden transition-[background-color] duration-700 ease-out"
      aria-hidden="true"
      style={{ 'background-color': backgroundColor() }}
    >
      {/* 1. Frosted Album Artwork Ambient Layer (Always present underneath as baseline; never black) */}
      <ImageFrost
        src={props.artworkUrl}
        palette={color()?.palette}
        dim={(color()?.lum ?? 0) > 0.6 ? 0.6 : 0.42}
        class="bg-transparent"
      />

      {/* 2. Fullscreen Video playing in background with modern liquid glass blur: smoothly cross-fades when video is ready */}
      <div
        class={`absolute inset-0 size-full overflow-hidden pointer-events-none select-none transition-opacity duration-1000 ease-in-out ${
          isVideoMode() ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Show when={isVideoMode() ? props.motionVideo : null}>
          {(video) => (
            <MotionFrost
              video={video()}
              detail={220}
              dim={0.22}
              class="absolute inset-0 size-full scale-[1.06]"
            />
          )}
        </Show>

        {/* Crystalline Liquid Glass Transparency & Specular Sheen Layer (Zero Dirty Grey, Pure Color Transmission) */}
        <div
          class="absolute inset-0 size-full pointer-events-none"
          style={{
            background:
              'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, transparent 40%, rgba(255, 255, 255, 0.02) 100%), ' +
              'linear-gradient(to top, rgba(6, 6, 10, 0.62) 0%, rgba(6, 6, 10, 0.12) 40%, transparent 70%)',
          }}
        />
      </div>
    </div>
  );
}
