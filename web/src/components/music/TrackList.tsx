import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { PrefetchLink } from '@/components/PrefetchLink';
import { PauseIcon, PlayIcon } from '@/components/icons/Transport';
import type { Track } from '@/lib/types';
import { playerStore } from '@/store/player';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { albumHref, artistLink, formatDuration } from './links';
import { playList } from './play';
import { TrackMenu } from './TrackMenu';

type Variant = 'album' | 'playlist';

const ROW_HEIGHT: Record<Variant, number> = { album: 46, playlist: 54 };
/** Playlists with 40+ tracks are virtualized for butter-smooth 60fps scrolling. */
const VIRTUALIZE_FROM = 40;

interface TrackListProps {
  tracks: Track[];
  variant: Variant;
  /** Album artwork, for rows that have none of their own (album tracks). */
  fallbackArtwork?: string | null;
  /** Called when the list nears its end, to load the next page of a long playlist. */
  onNearEnd?: () => void;
  /** Clicking a row queues the whole list from there. */
  onPlayRow?: (index: number) => void;
}

/* Track lists (report §3 album rows, §14 playlist rows). */

const cell = 'flex h-full min-w-0 items-center';
// 396 / 274 / 274 / 141 at 1440px (report §14).
const playlistColumns = 'grid-cols-[minmax(0,36.5fr)_minmax(0,25.25fr)_minmax(0,25.25fr)_minmax(0,13fr)]';
// Artist and album: playlists only, and not below 768px.
const secondary = `${cell} pe-2.5 max-md:hidden`;
const tertiary = `${cell} pe-4 max-md:hidden`;
const link = 'text-inherit hover:underline group-data-current/row:text-primary';

/**
 * Soft glass rows, as Apple's newest lists draw them: each row is its own
 * rounded card (a 2px gap above and below, from a transparent border the
 * fill is clipped inside), brighter on hover, tinted red for the playing row.
 */
const row = [
  'group/row track-row relative grid items-center',
  'border border-white/[0.06] hover:border-white/[0.18] hover:bg-white/[0.06]',
  'transition-colors duration-150 ease-out select-none will-change-[background-color,border-color]',
  'data-current:bg-[color-mix(in_srgb,var(--keyColor)_24%,rgba(255,255,255,0.08))] data-current:border-white/25',
].join(' ');

const rowVariant: Record<Variant, string> = {
  album: 'h-[46px] grid-cols-[minmax(0,1fr)_auto] rounded-row',
  playlist: `h-[54px] ${playlistColumns} rounded-[10px] max-md:grid-cols-[minmax(0,1fr)_auto]`,
};

function Artists(props: { track: Track }) {
  const artists = () => props.track.artists || [];
  return (
    <>
      <For each={artists()}>
        {(artist, i) => {
          const href = () => artistLink(props.track.artistIds?.[i()], artist);
          const total = artists().length;
          const isLast = () => i() === total - 1;
          const isSecondToLast = () => i() === total - 2;
          return (
            <span>
              <Show when={href()} fallback={<span>{artist}</span>}>
                <PrefetchLink to={href()!} hint={{ title: artist }} class={link} onClick={(e) => e.stopPropagation()}>
                  {artist}
                </PrefetchLink>
              </Show>
              <Show when={!isLast()}>
                <span>{total === 2 || isSecondToLast() ? ' & ' : ', '}</span>
              </Show>
            </span>
          );
        }}
      </For>
    </>
  );
}

const time: Record<Variant, string> = {
  album: 'relative justify-end pe-3 type-body tabular-nums',
  playlist: 'relative justify-end pe-[18px] type-body tabular-nums',
};

function AppleEqualizer() {
  return (
    <span class="inline-flex items-end justify-center gap-[2px] h-3.5 w-3.5" aria-hidden="true">
      <span class="w-[2px] rounded-full bg-[#fa2d4f] animate-[eq1_1.1s_ease-in-out_infinite]" />
      <span class="w-[2px] rounded-full bg-[#fa2d4f] animate-[eq2_0.85s_ease-in-out_infinite]" />
      <span class="w-[2px] rounded-full bg-[#fa2d4f] animate-[eq3_1.2s_ease-in-out_infinite]" />
    </span>
  );
}

interface RowProps {
  track: Track;
  variant: Variant;
  position: number;
  fallbackArtwork: string | null | undefined;
  onPlayRow: () => void;
}

function RowBase(props: RowProps) {
  const track = () => props.track;
  const current = () => playerStore.current?.id === track().id;
  const playing = () => playerStore.current?.id === track().id && playerStore.playing;
  const onPlay = () => (current() ? playerStore.toggle() : props.onPlayRow());

  return (
    <div
      class={`${row} ${rowVariant[props.variant]} cursor-pointer`}
      data-variant={props.variant}
      data-current={current() || undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, [role="menu"]')) return;
        onPlay();
      }}
    >
      <div class={`${cell} gap-3 min-w-0`}>
        <div class={`relative grid w-10 shrink-0 place-items-center${props.variant === 'playlist' ? ' ms-[7px]' : ''}`}>
          <Show when={props.variant === 'playlist'} fallback={
            <span class="type-body text-secondary group-hover/row:invisible">
              <Show when={current()} fallback={<span>{track().trackNumber ?? props.position}</span>}>
                <span class="grid place-items-center text-key group-hover/row:invisible" aria-label="Now playing">
                  <Show when={playing()} fallback={<PlayIcon size={14} />}>
                    <AppleEqualizer />
                  </Show>
                </span>
              </Show>
            </span>
          }>
            <>
              <Artwork
                src={track().thumb}
                fallbackSrc={props.variant === 'album' ? props.fallbackArtwork : undefined}
                track={track()}
                displayWidth={40}
                radius="var(--radius-artwork-small)"
              />
              <Show when={current()}>
                {/* The playing row's marker: an equalizer over the artwork. */}
                <span
                  class="absolute inset-0 grid place-items-center rounded-artwork-sm bg-[rgb(0_0_0/0.45)] text-key group-hover/row:invisible"
                  aria-label="Now playing"
                >
                  <Show when={playing()} fallback={<PlayIcon size={18} />}>
                    <AppleEqualizer />
                  </Show>
                </span>
              </Show>
            </>
          </Show>
          <button
            class={`absolute inset-0 grid place-items-center rounded-artwork-sm opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 ${
              props.variant === 'playlist' ? 'bg-black/45 text-white' : 'text-primary'
            }`}
            aria-label={playing() ? `Pause ${track().title}` : `Play ${track().title}`}
            onClick={onPlay}
          >
            {playing() ? <PauseIcon size={props.variant === 'playlist' ? 18 : 16} /> : <PlayIcon size={props.variant === 'playlist' ? 18 : 16} />}
          </button>
        </div>
        {/* The text column must be allowed to shrink, or a long title pushes the
            row's other cells out of the grid instead of being truncated. */}
        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class={`min-w-0 truncate type-body ${current() ? 'text-[#fa2d4f] font-semibold' : 'text-primary'}`}>{track().title}</span>
            <Show when={track().explicit}>
              <ExplicitBadge />
            </Show>
          </div>
          <Show when={props.variant === 'album' && (track().artists?.length ?? 0) > 0}>
            {/* The artist line lifts a touch when the row is hovered: a scale
                transform, so the row's layout never moves. */}
            <div class="track-artists min-w-0 truncate type-callout">
              <Artists track={track()} />
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.variant === 'playlist'}>
        <div class={secondary}>
          <span class="min-w-0 truncate type-body">
            <Artists track={track()} />
          </span>
        </div>
        <div class={tertiary}>
          <span class="min-w-0 truncate type-body">
            <Show when={track().album} fallback={null}>
              <Show
                when={albumHref(track().albumId)}
                fallback={<span>{track().album}</span>}
              >
                <PrefetchLink to={albumHref(track().albumId)!} class={link} onClick={(e) => e.stopPropagation()}>
                  {track().album}
                </PrefetchLink>
              </Show>
            </Show>
          </span>
        </div>
      </Show>
      <div class={`${cell} ${time[props.variant]}`}>
        {/* The ⋯ button (TrackMenu) takes the time's place on hover, as Apple's rows do. */}
        <span class="group-focus-within/row:invisible group-hover/row:invisible group-has-[[data-open]]/row:invisible">
          {formatDuration(track().duration)}
        </span>
        <TrackMenu
          track={track()}
          class="absolute end-2.5 hidden size-7 place-items-center rounded-full text-key group-focus-within/row:grid group-hover/row:grid hover:bg-quinary data-open:grid"
        />
      </div>
    </div>
  );
}

/**
 * Album and playlist track lists (report §3, §14): hairline-divided rows,
 * hover fill, the number (or artwork) turning into a play button. Long lists
 * are virtualized against the page's scroll container.
 */
export function TrackList(props: TrackListProps) {
  const playRow = (i: number) => (props.onPlayRow ? props.onPlayRow(i) : playList(props.tracks, i));
  let container!: HTMLDivElement;
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(null);
  // Where the list starts inside the scroll container. The virtualizer has to know this: the
  // album's header sits above the rows, and with a margin of 0 it picked rows for the wrong
  // part of the list, so rows popped in late and blanks showed while scrolling.
  const [listTop, setListTop] = createSignal(0);
  const measureTop = () => {
    if (!container) return;
    const top = container.offsetTop;
    if (Math.abs(top - listTop()) > 1) setListTop(top);
  };
  onMount(() => {
    const scroller = document.getElementById('scrollable-page');
    setScrollElement(scroller);
    if (!scroller || !container) return;
    measureTop();
    const observer = new ResizeObserver(() => measureTop());
    observer.observe(container);
    if (container.parentElement) observer.observe(container.parentElement);
    onCleanup(() => observer.disconnect());
  });
  const virtual = () => props.tracks.length >= VIRTUALIZE_FROM;

  const virtualizer = createVirtualizer({
    // A getter, so the row count always matches the list it virtualizes.
    get count() {
      return virtual() ? props.tracks.length : 0;
    },
    getScrollElement: () => scrollElement() as HTMLElement | null,
    estimateSize: () => ROW_HEIGHT[props.variant],
    overscan: 10,
    get scrollMargin() {
      return listTop();
    },
  });

  const items = createMemo(() => (virtual() ? virtualizer.getVirtualItems() : []));

  createEffect(() => {
    if (!props.onNearEnd) return;
    const list = items();
    const last = list[list.length - 1];
    if (virtual() ? last && last.index >= props.tracks.length - 20 : true) props.onNearEnd();
  });

  return (
    <div class="mx-(--body-gutter) type-callout text-secondary" data-variant={props.variant} role="table" aria-label="Songs">
      <Show when={props.variant === 'playlist'}>
        <Header />
      </Show>
      <div ref={container}>
        <Show when={virtual()} fallback={
          <For each={props.tracks}>
            {(track, i) => (
              <RowBase
                track={track}
                variant={props.variant}
                position={i() + 1}
                fallbackArtwork={props.fallbackArtwork}
                onPlayRow={() => playRow(i())}
              />
            )}
          </For>
        }>
          <div style={{ height: `${virtualizer.getTotalSize()}px`, 'position': 'relative' }}>
            <For each={items()}>
              {(item) => (
                <div
                  style={{
                    'position': 'absolute',
                    'top': '0px',
                    'left': '0px',
                    'right': '0px',
                    'transform': `translate3d(0, ${item.start - virtualizer.options.scrollMargin}px, 0)`,
                    'height': `${ROW_HEIGHT[props.variant]}px`,
                  }}
                >
                  <RowBase
                    track={props.tracks[item.index]!}
                    variant={props.variant}
                    position={item.index + 1}
                    fallbackArtwork={props.fallbackArtwork}
                    onPlayRow={() => playRow(item.index)}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

/**
 * The playlist table's column heads, in the same grid as the rows.
 */
function Header() {
  const head = 'type-[700_11px/14px] tracking-[0.06em] text-tertiary uppercase';
  return (
    <div class={`${playlistColumns} grid-cols-[minmax(0,36.5fr)_minmax(0,25.25fr)_minmax(0,25.25fr)_minmax(0,13fr)] grid h-8 items-center rounded-none border-y-0 bg-transparent px-0`} role="row">
      <span class={`${cell} ${head}`}>Song</span>
      <span class={`${secondary} ${head}`}>Artist</span>
      <span class={`${tertiary} ${head}`}>Album</span>
      <span class={`${cell} ${time.playlist} ${head}`} />
    </div>
  );
}
