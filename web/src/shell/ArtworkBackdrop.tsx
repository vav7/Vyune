import { createEffect, Show } from 'solid-js';
import { knownArtworkColor, lastArtworkColor, rememberArtworkColor, useArtworkColor } from '@/lib/artworkColor';
import { ImageFrost } from '@/components/music/ImageFrost';
import { MotionFrost } from '@/components/music/MotionFrost';

/**
 * The player's backdrop: the artwork frosted the cheap way (see ImageFrost),
 * with the song's motion clip or music video fading in over it.
 *
 * The base colour is never a default: it comes from the artwork's cached
 * colour (measured on hover and when the song was queued), and until it lands
 * the backdrop holds the colour the player showed last and glides to the new one.
 */
export function ArtworkBackdrop(props: {
  artworkUrl: string | null;
  /** A picture whose colour is already known (the queued thumbnail). */
  fallbackUrl?: string | null;
  motionVideo?: HTMLVideoElement | null;
}) {
  const measured = useArtworkColor(() => props.artworkUrl);
  const color = () => measured() ?? knownArtworkColor(props.fallbackUrl ?? null) ?? null;

  createEffect(() => {
    rememberArtworkColor(color());
  });

  const backgroundColor = () => {
    const base = color() ?? lastArtworkColor();
    return base ? `color-mix(in srgb, ${base.background} 70%, #07070b 30%)` : '#0a0a0e';
  };

  return (
    <div
      class="absolute inset-0 -z-1 overflow-hidden transition-[background-color] duration-700 ease-out"
      aria-hidden="true"
      style={{ 'background-color': backgroundColor() }}
    >
      <ImageFrost src={props.artworkUrl} palette={color()?.palette} dim={(color()?.lum ?? 0) > 0.6 ? 0.6 : 0.42} class="bg-transparent" />
      <Show when={props.motionVideo}>
        {(video) => <MotionFrost video={video()} dim={0.3} class="animate-[fade-in_1.6s_ease_both]" />}
      </Show>
    </div>
  );
}
