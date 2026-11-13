import { Shuffle } from 'lucide-solid';
import { createSignal, For, Show, type JSX } from 'solid-js';
import { PrefetchLink } from '@/components/PrefetchLink';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { artistHref } from './links';

interface DetailHeaderProps {
  title: string;
  /** The kind line ("Album", "Playlist"), as Apple's subtitle. */
  subtitle?: string | null;
  /** Year · counts, after the subtitle. */
  meta?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  artists?: { name: string; id?: string | null }[];
  explicit?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  canPlay: boolean;
  /** More actions after Play (a favorite toggle, a share button). */
  extra?: JSX.Element;
  /** Tapping the poster does this (the album's video background on/off). */
  onPosterClick?: () => void;
  posterLabel?: string;
}

/** Shuffle (circle) · Play (pill), report §14. */
export const detailButton = {
  pill: 'vy-btn vy-btn--primary vy-btn--pill',
  circle: 'vy-btn vy-btn--glass vy-btn--icon',
};

/**
 * Album and playlist header (report §3, §14): artwork with its glow, title,
 * artist, metadata, a three-line description, then Shuffle · Play.
 */
export function DetailHeader(props: DetailHeaderProps) {
  const [expanded, setExpanded] = createSignal(false);
  const artists = () => props.artists ?? [];
  return (
    // Artwork beside the headings, description and actions; stacked and centred below 768px.
    <div class="mx-(--body-gutter) mb-10 grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr_auto] gap-x-[34px] pt-11 [grid-template-areas:'artwork_headings'_'artwork_description'_'artwork_actions'] max-md:grid-cols-[1fr] max-md:grid-rows-[auto] max-md:justify-items-center max-md:pt-4 max-md:text-center max-md:[grid-template-areas:'artwork'_'headings'_'actions'_'description']">
      <div class="relative w-[270px] self-start rounded-artwork-lg shadow-[0_10px_20px_0_var(--radiosityShadowColor)] [grid-area:artwork] max-lg:w-[220px] max-md:w-[min(270px,70vw)]">
        <Show when={props.thumbnail}>
          {/* A blurred copy behind the artwork: Apple's radiosity glow. */}
          <div class="absolute inset-0 -z-1 scale-88 opacity-30 blur-[20px] saturate-200" aria-hidden="true">
            <Artwork src={props.thumbnail} displayWidth={80} radius="var(--radius-artwork-large)" />
          </div>
        </Show>
        <Show
          when={props.onPosterClick}
          fallback={<Artwork src={props.thumbnail} displayWidth={270} radius="var(--radius-artwork-large)" eager />}
        >
          <button
            type="button"
            class="block w-full cursor-pointer rounded-artwork-lg active:scale-[0.985] transition-transform duration-200"
            onClick={() => props.onPosterClick?.()}
            aria-label={props.posterLabel}
            title={props.posterLabel}
          >
            <Artwork src={props.thumbnail} displayWidth={270} radius="var(--radius-artwork-large)" eager />
          </button>
        </Show>
      </div>
      <div class="flex flex-col pt-[37px] [grid-area:headings] max-md:items-center max-md:pt-5">
        <h1 class="flex items-center type-large-title-emphasized leading-[38px] tracking-[-0.025em] max-md:justify-center">
          {props.title}
          <Show when={props.explicit}>
            <ExplicitBadge size={16} />
          </Show>
        </h1>
        <Show when={artists().length > 0}>
          <div class="type-large-title leading-[34px] text-primary">
            <For each={artists()}>
              {(artist, i) => {
                const href = () => artistHref(artist.id);
                return (
                  <span>
                    <Show when={i() > 0}>, </Show>
                    <Show when={href()} fallback={<span>{artist.name}</span>}>
                      <PrefetchLink to={href()!} class="hover:underline">
                        {artist.name}
                      </PrefetchLink>
                    </Show>
                  </span>
                );
              }}
            </For>
          </div>
        </Show>
        <div class="mt-1 type-callout-emphasized text-secondary">{[props.subtitle, props.meta].filter(Boolean).join(' · ')}</div>
      </div>
      <Show when={props.description}>
        <div class="mt-[38px] flex max-w-[440px] items-end type-body-tall text-secondary [grid-area:description] max-md:mt-5">
          <p class={expanded() ? 'min-w-0' : 'min-w-0 line-clamp-3'}>{props.description}</p>
          <Show when={!expanded() && (props.description?.length ?? 0) > 180}>
            <button class="shrink-0 ps-[5px] type-subhead-emphasized text-primary" onClick={() => setExpanded(true)}>
              MORE
            </button>
          </Show>
        </div>
      </Show>
      <div class="mt-3.5 flex items-center gap-3.5 self-end [grid-area:actions] max-md:justify-center">
        <button class={detailButton.circle} aria-label="Shuffle" onClick={() => props.onShuffle()} disabled={!props.canPlay}>
          <Shuffle size={18} strokeWidth={2.2} />
        </button>
        <button class={detailButton.pill} onClick={() => props.onPlay()} disabled={!props.canPlay}>
          <PlayIcon size={18} />
          <span>Play</span>
        </button>
        {props.extra}
      </div>
    </div>
  );
}
