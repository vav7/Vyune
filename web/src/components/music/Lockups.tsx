import { For, Show } from 'solid-js';
import { PrefetchLink } from '@/components/PrefetchLink';
import { prewarmArtworkColor } from '@/lib/artworkColor';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { albumHref, artistLink, hrefFor } from './links';
import { playTrack } from './play';
import { CardMenu } from './CardMenu';
import { isPlayable, type MusicItem } from './types';
import type { Track } from '@/lib/types';
import { playerStore } from '@/store/player';

/* Lockups (report §2), adapted to this app's items. */
const lockup = 'flex min-w-0 flex-col';
const caption = 'mt-2 flex min-w-0 flex-col gap-px';
const title = 'flex min-w-0 items-center type-callout [&>:first-child]:truncate';
const subtitle = 'truncate type-callout text-secondary';
const overlayLink = 'absolute inset-0 z-1 rounded-[inherit]';

/** Artist names as links where the catalogue linked them, else the subtitle. */
function Byline(props: { item: MusicItem }) {
  const item = () => props.item;
  const linked = () => (item().artistIds || []).some((a) => a);
  if (item().kind === 'album' || item().kind === 'playlist' || item().kind === 'radio') {
    return <>{item().subtitle}</>;
  }
  if (!linked()) {
    return <>{item().artists.length ? item().artists.join(', ') : item().albumId ? '' : item().subtitle}</>;
  }
  return (
    <For each={item().artists}>
      {(artist, i) => {
        const href = () => artistLink(item().artistIds?.[i()], artist);
        return (
          <span>
            {i() > 0 && ', '}
            <Show when={href()} fallback={<span>{artist}</span>}>
              <PrefetchLink to={href()!} class="hover:underline">
                {artist}
              </PrefetchLink>
            </Show>
          </span>
        );
      }}
    </For>
  );
}

function PlayPlatter(props: { item: MusicItem; onPlay?: () => void }) {
  return (
    <button
      class="lockup-platter z-3"
      aria-label={`Play ${props.item.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (props.onPlay) props.onPlay();
        else if (props.item.track) playTrack(props.item.track);
      }}
    >
      <PlayIcon size={16} />
    </button>
  );
}

/**
 * The artwork with its hover treatment. The picture, the dim and the platter
 * all live in one clipped frame (styles/glass.css), so the dim is always
 * exactly the picture's size: the picture zooms inside the frame instead of
 * the frame scaling, and there is no colour wash, only a neutral dim.
 */
function LockupArtwork(props: { item: MusicItem; width: number; aspect: number }) {
  const item = () => props.item;
  const href = () => (isPlayable(item()) ? null : hrefFor(item().kind, item().id));
  return (
    <div class="lockup-art group/art relative rounded-artwork-md" onPointerEnter={() => prewarmArtworkColor(item().thumbnail)}>
      <div class="lockup-frame">
        <Artwork
          src={item().thumbnail}
          track={item().track}
          displayWidth={props.width}
          aspect={props.aspect}
          radius="var(--radius-artwork-medium)"
        />
        <Show when={href()}>
          <PrefetchLink
            to={href()!}
            class={overlayLink}
            aria-label={item().title}
            hint={{ title: item().title, thumb: item().thumbnail, subtitle: item().subtitle }}
          />
        </Show>
        <Show when={!href()}>
          <button class={overlayLink} aria-label={`Play ${item().title}`} onClick={() => item().track && playTrack(item().track)} />
        </Show>
        <div class="lockup-scrim" aria-hidden="true" />
        <Show when={isPlayable(item())}>
          <PlayPlatter item={item()} />
        </Show>
      </div>
      {/* The card's own ⋯ menu, over the frame's top-right corner. */}
      <CardMenu
        item={item()}
        class="absolute end-2 top-2 z-3 grid size-7 place-items-center rounded-full bg-black/55 text-white/90 opacity-0 backdrop-blur-md transition-[opacity,background-color] duration-150 ease-out hover:bg-black/75 hover:text-white group-hover/art:opacity-100 focus-visible:opacity-100 data-open:opacity-100"
      />
    </div>
  );
}

/** Square lockup (report §2): artwork, hover scrim with play platter, title and subtitle. */
export function SquareLockup(props: { item: MusicItem; width?: number }) {
  const item = () => props.item;
  const href = () => (isPlayable(item()) ? null : hrefFor(item().kind, item().id));
  const isCurrent = () => {
    const cur = playerStore.current;
    if (!cur) return false;
    return cur.id === item().id || (item().track && cur.id === item().track?.id);
  };
  return (
    <div class={lockup}>
      <LockupArtwork item={item()} width={props.width ?? 300} aspect={1} />
      <div class={caption}>
        <div class={title}>
          <Show when={href()} fallback={<span class={isCurrent() ? 'text-[#fa2d4f] font-semibold' : ''}>{item().title}</span>}>
            <PrefetchLink
              to={href()!}
              class={`hover:underline ${isCurrent() ? 'text-[#fa2d4f] font-semibold' : ''}`}
              hint={{ title: item().title, thumb: item().thumbnail, subtitle: item().subtitle }}
            >
              {item().title}
            </PrefetchLink>
          </Show>
          <Show when={item().explicit}>
            <ExplicitBadge />
          </Show>
        </div>
        <div class={subtitle}>
          <Byline item={item()} />
        </div>
      </div>
    </div>
  );
}

/** 16:9 video lockup (report §2, type C). */
export function VideoLockup(props: { item: MusicItem; width?: number }) {
  const item = () => props.item;
  return (
    <div class={lockup}>
      <LockupArtwork item={item()} width={props.width ?? 300} aspect={16 / 9} />
      <div class={caption}>
        <div class={title}>
          <span>{item().title}</span>
          <Show when={item().explicit}>
            <ExplicitBadge />
          </Show>
        </div>
        <div class={subtitle}>{item().subtitle}</div>
      </div>
    </div>
  );
}

/** Circular artist lockup (report §2, type H). */
export function CircleLockup(props: { item: MusicItem; width?: number }) {
  const item = () => props.item;
  return (
    <PrefetchLink
      to={hrefFor(item().kind, item().id) ?? '#'}
      class="circle-lockup group/circle flex min-w-0 flex-col items-center gap-2.5 rounded-[18px] p-2.5 outline-offset-0"
    >
      <span class="circle-lockup-art block rounded-full">
        <Artwork src={item().thumbnail} displayWidth={props.width ?? 160} radius="50%" />
      </span>
      <span class="max-w-full truncate text-center type-body text-white/85 transition-colors duration-200 group-hover/circle:text-white">{item().title}</span>
    </PrefetchLink>
  );
}

/** A song row inside a shelf (report §2, track lockup): larger art, title, linked credits. */
export function TrackLockup(props: { item: MusicItem; onPlay?: () => void }) {
  const item = () => props.item;
  const play = () => (props.onPlay ? props.onPlay() : item().track && playTrack(item().track));
  const isCurrent = () => {
    const cur = playerStore.current;
    if (!cur) return false;
    return cur.id === item().id || (item().track && cur.id === item().track?.id);
  };
  return (
    // 68px art column (56 + 12 gap), content; 72px tall. Clicking anywhere on
    // the row plays it, as Apple's list rows do; buttons and links keep their
    // own clicks.
    <div
      class={`track-row group/track grid h-[72px] cursor-pointer grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 rounded-[10px] border-y-[3px] border-transparent bg-card bg-clip-padding py-1.5 pr-3.5 pl-2 [box-shadow:inset_0_0_0_0.5px_var(--cardStroke)] transition-[background-color] duration-150 ease-out hover:-translate-y-px hover:bg-card-hover hover:shadow-[0_10px_26px_-16px_#000,inset_0_0_0_0.5px_var(--cardStroke)] ${
        isCurrent() ? 'bg-[radial-gradient(ellipse_at_50%_50%,rgba(250,45,79,0.22)_0%,rgba(250,45,79,0.09)_70%)] shadow-[inset_0_0_0_1px_rgba(250,45,79,0.36),0_0_28px_-4px_rgba(250,45,79,0.22)]' : ''
      }`}
      data-current={isCurrent() || undefined}
      onPointerEnter={() => prewarmArtworkColor(item().thumbnail)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        play();
      }}
    >
      <button class="group/art relative ml-0 w-14 rounded-artwork-sm" aria-label={`Play ${item().title}`} onClick={play}>
        <Artwork src={item().thumbnail} track={item().track} displayWidth={56} radius="var(--radius-artwork-small)" />
        <span
          class={`absolute inset-0 grid place-items-center rounded-[inherit] transition-opacity duration-150 ease-out ${
            isCurrent()
              ? 'bg-black/50 text-[#fa2d4f] opacity-100'
              : 'bg-black/45 text-white opacity-0 group-hover/track:opacity-100 group-focus-visible/art:opacity-100'
          }`}
          aria-hidden="true"
        >
          <PlayIcon size={18} />
        </span>
      </button>
      <div class="flex min-w-0 flex-col gap-px px-1">
        <div class="flex min-w-0 items-center type-body">
          <button class={`min-w-0 truncate text-left ${isCurrent() ? 'text-[#fa2d4f] font-semibold' : ''}`} onClick={play}>
            {item().title}
          </button>
          <Show when={item().explicit}>
            <ExplicitBadge />
          </Show>
        </div>
        <div class="truncate type-callout text-secondary">
          <Byline item={item()} />
          <Show when={item().album && item().albumId}>
            <>
              <span class="mx-1" aria-hidden="true">·</span>
              <PrefetchLink to={albumHref(item().albumId!)!} class="hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                {item().album}
              </PrefetchLink>
            </>
          </Show>
        </div>
      </div>
    </div>
  );
}

export type { Track };
