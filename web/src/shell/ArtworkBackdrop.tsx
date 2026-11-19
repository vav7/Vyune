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
                detail={220}
                dim={0.22}
                class="absolute inset-0 size-full scale-[1.06] animate-[fade-in_1s_ease_both]"
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
      </Show>
    </div>
  );
}
