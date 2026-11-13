import { createMemo, createSignal } from 'solid-js';
import { Link2, ListEnd, ListStart, MoreHorizontal, Radio, Star } from 'lucide-solid';
import { Menu, MenuItem, MenuSeparator } from '@/components/Menu';
import type { Track } from '@/lib/types';
import { playerStore } from '@/store/player';

/**
 * The ⋯ button at the end of a track row (report §14): queue actions, the
 * device's favorite, radio, and a share link for catalogue tracks.
 */
export function TrackMenu(props: { track: Track; class?: string }) {
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const liked = createMemo(() => playerStore.favorites.some((f) => f.id === props.track.id));
  return (
    <>
      <button
        class={props.class}
        aria-label={`More options for ${props.track.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor() !== null}
        data-open={anchor() !== null || undefined}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor() ? null : event.currentTarget);
        }}
        onDblClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {anchor() && (
        <Menu anchor={anchor()!} onClose={close} label={props.track.title}>
          <MenuItem icon={<ListStart size={15} />} onSelect={() => (close(), playerStore.enqueueNext(props.track))}>
            Play Next
          </MenuItem>
          <MenuItem icon={<ListEnd size={15} />} onSelect={() => (close(), playerStore.enqueue(props.track))}>
            Add to Queue
          </MenuItem>
          {props.track.source === 'yt' && (
            <MenuItem icon={<Radio size={15} />} onSelect={() => (close(), void playerStore.startRadio(props.track))}>
              Start Radio
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Star size={15} fill={liked() ? 'currentColor' : 'none'} />}
            onSelect={() => {
              close();
              const added = playerStore.toggleFavorite(props.track);
              playerStore.showToast(added ? `♥ ${props.track.title}` : `Removed ${props.track.title}`);
            }}
          >
            {liked() ? 'Unfavorite' : 'Favorite'}
          </MenuItem>
          {props.track.source === 'yt' && (
            <MenuItem
              icon={<Link2 size={15} />}
              onSelect={() => {
                close();
                void navigator.clipboard?.writeText(`${location.origin}/t/${props.track.id}`);
                playerStore.showToast('Share link copied');
              }}
            >
              Copy Share Link
            </MenuItem>
          )}
        </Menu>
      )}
    </>
  );
}
