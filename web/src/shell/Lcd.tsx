import { For, Show } from 'solid-js';
import { Maximize2 } from 'lucide-solid';
import { AppleMotionArtwork } from '@/components/music/AppleMotionArtwork';
import { artModeStore } from '@/store/artMode';
import { LogoMark } from '@/components/LogoMark';
import { ExplicitBadge } from '@/components/music/ExplicitBadge';
import { albumHref, artistHref } from '@/components/music/links';
import { PrefetchLink } from '@/components/PrefetchLink';
import { SongTitle } from '@/components/music/SongTitle';
import { creditSegments } from '@/lib/artistCredits';
import { sizedArtwork } from '@/lib/artwork';
import { playerStore, thumbCandidates } from '@/store/player';
import { useScrubber } from './useScrubber';

// The title and each artist: plain until hovered, then underlined on their own.
export const pageLink = 'cursor-pointer text-start hover:underline focus-visible:underline';

/** The artists, each its own link where the catalogue linked one. */
export function Credits() {
  return (
    <Show when={playerStore.current} keyed>
      {(current) => {
        const line = (current.artists || []).filter(Boolean).join(', ') || current.channel || 'Artist unavailable';
        const segments = creditSegments(line, current.artists || [], current.artistIds);
        return (
          <For each={segments}>
            {(segment) =>
              segment.id ? (
                <PrefetchLink class={pageLink} to={artistHref(segment.id)!}>
                  {segment.text}
                </PrefetchLink>
              ) : (
                <span>{segment.text}</span>
              )
            }
          </For>
        );
      }}
    </Show>
  );
}

// As wide as the name, so only the name opens the album.
const titleClass = 'min-w-0 max-w-full self-start truncate type-body-emphasized';

/** The now-playing tile inside the pill (report §1, "LCD"). */
export function Lcd() {
  return (
    <Show
      when={playerStore.current}
      keyed
      fallback={
        <div class="grid h-full place-items-center text-tertiary">
          <LogoMark size={26} />
        </div>
      }
    >
      {(current) => {
        const thumb = thumbCandidates(current)[0] ?? null;
        return (
          <div class="group/lcd relative grid h-full grid-cols-[34px_minmax(0,1fr)] items-center gap-x-2 pb-1.5">
            {/* As Apple's: the artwork opens the full-screen player, with an expand glyph on hover. */}
            <button
              class="group/art relative block size-[36px] overflow-hidden rounded-[8px] bg-joe p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_12px_rgba(0,0,0,0.45)] transition-[filter,opacity,transform] duration-200 hover:scale-105 active:scale-95"
              aria-label="Open full screen player"
              onClick={() => playerStore.setFullscreen(true)}
            >
              <Show when={thumb}>
                {(src) => (
                  <img
                    src={sizedArtwork(src(), 36)}
                    alt=""
                    referrerPolicy="no-referrer"
                    decoding="async"
                    class="size-full object-cover opacity-0 transition-opacity duration-200 ease-in data-loaded:opacity-100"
                    onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
                    onError={(e) => {
                      // walk the fallback ladder quietly
                      const chain = thumbCandidates(current);
                      const next = chain.find((u) => u !== e.currentTarget.src);
                      if (next) e.currentTarget.src = next;
                    }}
                  />
                )}
              </Show>
              <Show when={artModeStore.mode !== 'static'}>
                <AppleMotionArtwork track={current} mode={artModeStore.mode} />
              </Show>
              {/* Hovering anywhere on the player pill dims the artwork and shows the expand glyph. */}
              <span
                class="absolute inset-0 z-20 grid place-items-center bg-[rgb(0_0_0/0.45)] backdrop-blur-[2px] text-white opacity-0 transition-opacity duration-200 group-hover/pill:opacity-100 group-focus-visible/art:opacity-100"
                aria-hidden="true"
              >
                <Maximize2 size={14} strokeWidth={2.25} />
              </span>
            </button>
            {/* Over the seek line, the names soften into the background so the times can sit over them. */}
            <div class="flex min-w-0 flex-col transition-[filter,opacity] group-has-[[data-scrubber]:hover]/lcd:opacity-30 group-has-[[data-scrubber]:hover]/lcd:blur-[3px] group-has-[[data-dragging]]/lcd:opacity-30 group-has-[[data-dragging]]/lcd:blur-[3px]">
              <div class="flex min-w-0 items-center">
                <SongTitle
                  title={current.title}
                  href={current.albumId ? albumHref(current.albumId) : (current.album ? `/search?q=${encodeURIComponent(current.album)}&filter=albums` : undefined)}
                  class={titleClass}
                />
                <Show when={current.explicit}>
                  <ExplicitBadge size={11} />
                </Show>
              </div>
              <span class="truncate type-callout-medium text-secondary">
                <Credits />
                <Show when={playerStore.loading && !(current.artists || []).length}>Loading…</Show>
              </span>
            </div>
            <Progress />
          </div>
        );
      }}
    </Show>
  );
}

// Elapsed and remaining, over the line's two ends while the pointer is on it.
const time =
  'pointer-events-none absolute bottom-[11px] type-[600_11px/13px] tabular-nums text-primary opacity-0 transition-opacity group-hover/scrub:opacity-100 group-data-dragging/scrub:opacity-100';

/**
 * Elapsed time as a 2px line along the LCD's bottom (report §1). Hovering
 * shows the times; pressing or dragging on the line seeks.
 */
function Progress() {
  const { setBarRef, setElapsedRef, setRemainingRef, dragging, handlers } = useScrubber();
  return (
    // The hit area: taller than the 2px line it carries.
    <div
      class="group/scrub absolute inset-x-0 bottom-0 h-4 cursor-pointer touch-none"
      data-scrubber
      data-dragging={dragging() || undefined}
      {...handlers}
    >
      <span ref={setElapsedRef} class={`${time} left-0`} />
      <span ref={setRemainingRef} class={`${time} right-0`} />
      <div
        class="absolute inset-x-0 bottom-1.5 h-1 overflow-hidden rounded-[2px] bg-white/15 backdrop-blur-sm transition-[height,bottom,background-color] duration-150 ease-out group-hover/scrub:bottom-2 group-hover/scrub:h-1.5 group-data-dragging/scrub:bottom-2 group-data-dragging/scrub:h-1.5"
        aria-hidden="true"
      >
        <div
          ref={setBarRef}
          class="size-full origin-left scale-x-(--progress) bg-gradient-to-r from-white/90 via-white to-white shadow-[0_0_10px_rgba(255,255,255,0.6)] group-hover/scrub:shadow-[0_0_14px_rgba(255,255,255,0.9)] [--progress:0]"
        />
      </div>
    </div>
  );
}
