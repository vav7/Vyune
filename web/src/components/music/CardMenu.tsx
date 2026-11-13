import { Link2, MoreHorizontal, Play, Radio } from 'lucide-solid';
import { createSignal, Show } from 'solid-js';
import { Menu, MenuItem, MenuSeparator } from '@/components/Menu';
import { playerStore } from '@/store/player';
import { hrefFor } from './links';
import type { MusicItem } from './types';

/**
 * The ⋯ button on a shelf card: what to do with this playlist or album.
 *
 * A card in a shelf has no row to hang a menu on, and the shelf scrolls
 * sideways, so the menu lives on the artwork itself — hidden until the card
 * is hovered or the button is focused, so a wall of playlists stays calm.
 */
export function CardMenu(props: { item: MusicItem; class?: string }) {
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const href = () => hrefFor(props.item.kind, props.item.id);

  return (
    <>
      <button
        class={props.class}
        aria-label={`More options for ${props.item.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor() !== null}
        data-open={anchor() !== null || undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setAnchor(anchor() ? null : event.currentTarget);
        }}
        onDblClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={16} strokeWidth={2.2} />
      </button>
      <Show when={anchor()}>
        <Menu anchor={anchor()!} onClose={close} label={props.item.title}>
          <MenuItem
            icon={<Play size={15} />}
            onSelect={() => {
              close();
              // A radio starts from its first track; a playlist has none here,
              // so the route is the honest action.
              if (props.item.kind === 'radio' && props.item.track) playerStore.startRadio(props.item.track);
              else if (href()) location.assign(href()!);
            }}
          >
            {props.item.kind === 'radio' ? 'Start Radio' : 'Open'}
          </MenuItem>
          <Show when={props.item.kind === 'radio' && props.item.track}>
            <MenuItem
              icon={<Radio size={15} />}
              onSelect={() => {
                close();
                void playerStore.startRadio(props.item.track!);
              }}
            >
              Play Radio
            </MenuItem>
          </Show>
          <MenuSeparator />
          <MenuItem
            icon={<Link2 size={15} />}
            onSelect={() => {
              close();
              void navigator.clipboard?.writeText(`${location.origin}${href() ?? '/'}`);
              playerStore.showToast('Share link copied');
            }}
          >
            Copy Share Link
          </MenuItem>
        </Menu>
      </Show>
    </>
  );
}
