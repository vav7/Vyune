import { ChevronLeft, ChevronRight } from 'lucide-solid';
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { PrefetchLink } from '@/components/PrefetchLink';
import { shelfHeader, shelfKinds, shelfList, shelfSection, type ShelfKind } from '@/components/shelf';
import type { Track } from '@/lib/types';
import { CircleLockup, SquareLockup, TrackLockup, VideoLockup } from './Lockups';
import { playList } from './play';
import { trackItem, type MusicItem, type Shelf } from './types';

// Arrow buttons (report §2): 28×52 glass pills, only ≥1000px, shown on shelf hover.
const arrow =
  'absolute top-1/2 z-3 hidden h-13 w-7 -translate-y-1/2 place-items-center rounded-pill bg-thin-material text-secondary opacity-0 transition-[opacity,background-color,color] duration-(--duration-arrow) ease-linear [backdrop-filter:saturate(180%)_blur(60px)] hover:text-primary disabled:pointer-events-none lg:grid lg:enabled:group-hover/shelf:opacity-100';

function renderItem(shelf: Shelf, item: MusicItem, onPlay?: () => void): JSX.Element {
  switch (shelf.layout) {
    case 'tracks':
      return <TrackLockup item={item} onPlay={onPlay} />;
    case 'video':
      return <VideoLockup item={item} />;
    case 'circle':
      return <CircleLockup item={item} />;
    default:
      return <SquareLockup item={item} />;
  }
}

/**
 * A shelf's scrolling row with Apple's hover arrows (report §2), around any
 * list items: the shelves below, and the artist page's Top Songs.
 */
export function ShelfScroller(props: { kind: ShelfKind; children: JSX.Element }) {
  let list!: HTMLUListElement;
  const [edges, setEdges] = createSignal({ start: true, end: true });

  const measure = () => {
    const el = list;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };

  onMount(() => {
    measure();
    const el = list;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  /** Pages by one viewport of columns, as Apple's arrows do. */
  const page = (direction: 1 | -1) => {
    const el = list;
    if (!el) return;
    const gutter = Number.parseFloat(getComputedStyle(el).paddingInlineStart) || 0;
    el.scrollBy({ left: direction * (el.clientWidth - gutter * 2), behavior: 'smooth' });
  };

  return (
    <div class="group/shelf relative">
      <button class={`${arrow} left-1.5`} aria-label="Previous Page" disabled={edges().start} onClick={() => page(-1)}>
        <ChevronLeft size={20} strokeWidth={2.4} />
      </button>
      <ul ref={list} class={`${shelfList} ${shelfKinds[props.kind]}`} onScroll={measure}>
        {props.children}
      </ul>
      <button class={`${arrow} right-1.5`} aria-label="Next Page" disabled={edges().end} onClick={() => page(1)}>
        <ChevronRight size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** A shelf's title, a link with a chevron when there's a page behind it. */
function ShelfTitle(props: { title: string; to?: string | null; extra?: JSX.Element }) {
  return (
    <div class={`${shelfHeader} gap-3`}>
      <h2 class="type-title-2-emphasized">
        <Show when={props.to} fallback={props.title}>
          <PrefetchLink to={props.to!} class="group/title inline-flex items-center gap-0.5">
            {props.title}
            <ChevronRight size={18} strokeWidth={2.6} class="text-secondary group-hover/title:text-primary" />
          </PrefetchLink>
        </Show>
      </h2>
      {props.extra}
    </div>
  );
}

/**
 * Songs in a shelf, as the phone's Top Songs and Recently Played: any one
 * plays the whole shelf from there.
 */
export function TrackShelf(props: { title: string; to?: string | null; tracks: Track[]; headerExtra?: JSX.Element }) {
  const tracks = () => props.tracks;
  return (
    <section class={shelfSection} aria-label={props.title}>
      <ShelfTitle title={props.title} to={props.to} extra={props.headerExtra} />
      <ShelfScroller kind="tracks">
        <For each={tracks()}>
          {(track, i) => (
            <li>
              <TrackLockup item={trackItem(track)} onPlay={() => playList(tracks(), i())} />
            </li>
          )}
        </For>
      </ShelfScroller>
    </section>
  );
}

/** The artist's top songs as a grid: five across on a wide screen, five rows deep, entering as a waterfall. */
export function TrackGridShelf(props: { title: string; tracks: Track[]; headerExtra?: JSX.Element; limit?: number; emphasized?: boolean }) {
  const shown = () => props.tracks.slice(0, props.limit ?? 25);
  return (
    <section class={shelfSection} aria-label={props.title} data-emphasized={props.emphasized || undefined}>
      <ShelfTitle title={props.title} extra={props.headerExtra} />
      <ul
        data-waterfall
        class="mx-(--body-gutter) grid grid-cols-1 gap-x-3 gap-y-0.5 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1200px]:grid-cols-5"
      >
        <For each={shown()}>
          {(track, i) => (
            <li style={{ '--i': i() }}>
              <TrackLockup item={trackItem(track)} onPlay={() => playList(shown(), i())} />
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

/** A titled horizontal shelf (report §2): grid columns per breakpoint, scroll-snap, hover arrows. */
export function ShelfView(props: { shelf: Shelf }) {
  const shelf = () => props.shelf;
  const tracks = () => shelf().tracks;
  return (
    <section class={`${shelfSection} ${shelf().className ?? ''}`} aria-label={shelf().title}>
      <ShelfTitle title={shelf().title} to={shelf().seeAll ?? null} />
      <Show when={shelf().detail}>
        <p class="mx-(--body-gutter) -mt-1 mb-3 type-callout text-secondary">{shelf().detail}</p>
      </Show>
      <ShelfScroller kind={shelf().layout}>
        <For each={shelf().items}>
          {(item) => (
            <li>
              {renderItem(
                shelf(),
                item,
                tracks() ? () => playList(tracks()!, Math.max(0, tracks()!.findIndex((t) => t.id === item.id))) : undefined,
              )}
            </li>
          )}
        </For>
      </ShelfScroller>
    </section>
  );
}

/** Shelves in order, each its own section. */
export function Shelves(props: { shelves: Shelf[] }) {
  return (
    <>
      <For each={props.shelves}>{(shelf) => <ShelfView shelf={shelf} />}</For>
    </>
  );
}
