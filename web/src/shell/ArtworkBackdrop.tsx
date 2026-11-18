import { createEffect, Show } from 'solid-js';
import { knownArtworkColor, lastArtworkColor, rememberArtworkColor, useArtworkColor } from '@/lib/artworkColor';
import { ImageFrost } from '@/components/music/ImageFrost';
import { MotionFrost } from '@/components/music/MotionFrost';
import type { ArtMode } from '@/store/artMode';

/**
 * The player's backdrop:
 * - Art Mode: Pure frosted artwork with static ambient lighting.
 * - Visualizer & MV Mode: The actual playing video in the background in full screen mode,
 *   with modern liquid glass transparent blur over it, clean, zero grain, and no other colors.
 */
export function ArtworkBackdrop(props: {
  artworkUrl: string | null;
  /** A picture whose colour is already known (the queued thumbnail). */
  fallbackUrl?: string | null;
  motionVideo?: HTMLVideoElement | null;
  mode?: ArtMode;
}) {
  const measured = useArtworkColor(() => props.artworkUrl);
  const color = () => measured() ?? knownArtworkColor(props.fallbackUrl ?? null) ?? null;

  createEffect(() => {
    rememberArtworkColor(color());
  });

  const isVideoMode = () => props.mode === 'visualiser' || props.mode === 'mv';

  const backgroundColor = () => {
    const base = color() ?? lastArtworkColor();
    return base ? `color-mix(in srgb, ${base.background} 70%, #07070b 30%)` : '#07070b';
  };

  return (
    <div
      class="absolute inset-0 -z-1 overflow-hidden transition-[background-color] duration-700 ease-out"
      aria-hidden="true"
      style={{ 'background-color': isVideoMode() ? '#07070b' : backgroundColor() }}
    >
      <Show
        when={isVideoMode()}
        fallback={
          <ImageFrost
            src={props.artworkUrl}
            palette={color()?.palette}
            dim={(color()?.lum ?? 0) > 0.6 ? 0.6 : 0.42}
            class="bg-transparent"
          />
        }
      >
        {/* Fullscreen Video playing in background with modern liquid glass blur and zero grain */}
        <div class="absolute inset-0 size-full overflow-hidden pointer-events-none select-none bg-[#07070b]">
          <Show when={props.motionVideo}>
            {(video) => (
              <MotionFrost
                video={video()}
                detail={180}
                dim={0.25}
                class="absolute inset-0 size-full scale-[1.08] animate-[fade-in_1s_ease_both]"
              />
            )}
          </Show>

          {/* Modern Liquid Glass Transparent Diffusion Overlay (Zero Grain, Pure Optical Blur) */}
          <div class="absolute inset-0 size-full backdrop-blur-[55px] bg-[#07070b]/35" />

          {/* Liquid Glass Specular Reflection Sheen & Depth Vignette */}
          <div
            class="absolute inset-0 size-full"
            style={{
              background:
                'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, transparent 45%, rgba(255, 255, 255, 0.02) 100%), ' +
                'radial-gradient(ellipse 95% 85% at 50% 50%, transparent 40%, rgba(7, 7, 11, 0.5) 80%, rgba(7, 7, 11, 0.88) 100%)',
            }}
          />
        </div>
      </Show>
    </div>
  );
}
