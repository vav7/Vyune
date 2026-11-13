import { createMemo, Show } from 'solid-js';
import { StarFilledIcon, StarIcon } from '@/components/icons/Transport';
import type { Track } from '@/lib/types';
import { playerStore } from '@/store/player';

interface FavoriteButtonProps {
  track: Track | null;
  class?: string;
  size?: number;
}

/**
 * Apple's Favorite star, backed by this device's favorites list. The state is
 * read from the store, so every surface agrees the moment one of them flips.
 */
export function FavoriteButton(props: FavoriteButtonProps) {
  const liked = createMemo(() =>
    props.track ? playerStore.favorites.some((f) => f.id === props.track!.id) : false,
  );
  return (
    <Show when={props.track}>
      {(track) => (
        <button
          class={props.class}
          aria-label={liked() ? 'Unfavorite' : 'Favorite'}
          aria-pressed={liked()}
          title={liked() ? 'Unfavorite' : 'Favorite'}
          onClick={(event) => {
            event.stopPropagation();
            const added = playerStore.toggleFavorite(track());
            playerStore.showToast(added ? `♥ ${track().title}` : `Removed ${track().title}`);
          }}
        >
          <Show when={liked()} fallback={<StarIcon size={props.size ?? 18} />}>
            <StarFilledIcon size={props.size ?? 18} />
          </Show>
        </button>
      )}
    </Show>
  );
}
