import { createEffect, createMemo, Show } from 'solid-js';
import { knownArtworkColor, lastArtworkColor, rememberArtworkColor, useArtworkColor } from '@/lib/artworkColor';
import { ImageFrost } from '@/components/music/ImageFrost';
import type { ArtMode } from '@/store/artMode';

/**
 * The player's backdrop:
 * - Art Mode: Pure frosted artwork with static ambient lighting.
 * - Visualizer & MV Mode: Modern Liquid Glass atmosphere — translucent glass diffusion,
 *   delicate specular sheen, rich organic ambient glow, 100% zero noise/grain.
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

  const isLiquidGlass = () => props.mode === 'visualiser' || props.mode === 'mv';

  const palette = createMemo(() => {
    const c = color() ?? lastArtworkColor();
    const p0 = c?.palette?.[0] || c?.background || '#2a2438';
    const p1 = c?.palette?.[1] || c?.palette?.[0] || '#1d1b2e';
    const p2 = c?.palette?.[2] || '#141324';
    return { p0, p1, p2, base: c?.background || '#07070b' };
  });

  const backgroundColor = () => {
    const base = color() ?? lastArtworkColor();
    return base ? `color-mix(in srgb, ${base.background} 70%, #07070b 30%)` : '#07070b';
  };

  return (
    <div
      class="absolute inset-0 -z-1 overflow-hidden transition-[background-color] duration-700 ease-out"
      aria-hidden="true"
      style={{ 'background-color': isLiquidGlass() ? '#07070b' : backgroundColor() }}
    >
      <Show
        when={isLiquidGlass()}
        fallback={
          <ImageFrost
            src={props.artworkUrl}
            palette={color()?.palette}
            dim={(color()?.lum ?? 0) > 0.6 ? 0.6 : 0.42}
            class="bg-transparent"
          />
        }
      >
        {/* Modern Liquid Glass Transparent Effect with Blur (Zero Grain, Pure Translucency) */}
        <div class="absolute inset-0 size-full overflow-hidden pointer-events-none select-none">
          {/* 1. Deep Obsidian glass foundation */}
          <div class="absolute inset-0 bg-[#07070b]/90 backdrop-blur-3xl" />

          {/* 2. Ultra-soft Liquid Glass Floating Color Refractions (zero grain, 110px GPU blur) */}
          <div
            class="absolute -top-[15%] -left-[10%] w-[68vw] h-[68vh] rounded-full opacity-60 transition-all duration-[2000ms] ease-out [filter:blur(110px)]"
            style={{
              background: `radial-gradient(circle, ${palette().p0} 0%, transparent 70%)`,
            }}
          />
          <div
            class="absolute -bottom-[20%] -right-[10%] w-[72vw] h-[72vh] rounded-full opacity-50 transition-all duration-[2000ms] ease-out [filter:blur(120px)]"
            style={{
              background: `radial-gradient(circle, ${palette().p1} 0%, transparent 70%)`,
            }}
          />
          <div
            class="absolute top-[32%] left-[30%] w-[55vw] h-[55vh] rounded-full opacity-35 transition-all duration-[2000ms] ease-out [filter:blur(100px)]"
            style={{
              background: `radial-gradient(circle, ${palette().p2} 0%, transparent 65%)`,
            }}
          />

          {/* 3. Liquid Glass Specular Diffusion Sheet */}
          <div
            class="absolute inset-0 size-full backdrop-blur-[70px] opacity-90 transition-opacity duration-1000"
            style={{
              background:
                'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 35%, transparent 60%, rgba(255, 255, 255, 0.02) 100%)',
            }}
          />

          {/* 4. Elegant Liquid Depth Veil — keeps controls and lyrics crisp and readable */}
          <div
            class="absolute inset-0 size-full"
            style={{
              background:
                'radial-gradient(ellipse 95% 85% at 50% 45%, transparent 40%, rgba(7, 7, 11, 0.5) 80%, rgba(7, 7, 11, 0.88) 100%)',
            }}
          />
        </div>
      </Show>
    </div>
  );
}
