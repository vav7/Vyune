import { GripVertical } from 'lucide-solid';
import { useLocation } from '@solidjs/router';
import { SongTitle } from '@/components/music/SongTitle';
import { albumHref } from '@/components/music/links';
import { createSignal, Show } from 'solid-js';
import {
  BackwardIcon,
  ForwardIcon,
  LyricsActiveIcon,
  LyricsIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
} from '@/components/icons/Transport';
import { FavoriteButton } from '@/components/music/FavoriteButton';
import { cleanArtistDisplay } from '@/lib/artistCredits';
import { thumbCandidates, playerStore } from '@/store/player';
import type { Track } from '@/lib/types';
import { uiStore } from '@/store/ui';
import { useSongTint } from '@/lib/useSongTint';
import { startDockDrag } from './dock';
import { Lcd } from './Lcd';
import { PlayerMenu } from './PlayerMenu';
import { useScrubber as useScrubberLocal } from './useScrubber';

const control = 'grid place-items-center rounded-[8px] transition-all duration-200 ease-out hover:scale-110 active:scale-90 disabled:opacity-40';
// Shuffle and repeat: secondary, and the key colour when on, as Apple's toggles.
const toggleBtn = `${control} size-7 text-secondary hover:text-primary aria-pressed:text-key aria-pressed:bg-white/[0.14] aria-pressed:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_8px_rgba(0,0,0,0.3)]`;
const transport = `${control} size-8 text-primary hover:bg-white/[0.12] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_8px_rgba(0,0,0,0.3)] rounded-full`;
const action = 'grid h-7 w-6 place-items-center rounded-[6px] text-secondary hover:text-primary hover:bg-white/[0.12] aria-pressed:text-key transition-all duration-150 active:scale-90';
// The actions the volume level slides in over: they fade out while it's open.
const fading = `${action} transition-opacity group-data-volume-open/actions:pointer-events-none group-data-volume-open/actions:opacity-0`;

const slider = [
  'absolute top-1/2 right-[33px] mx-0 mb-0 -mt-2 block h-4 w-24 cursor-pointer appearance-none bg-transparent',
  'pointer-events-none translate-x-2 opacity-0 transition-[opacity,translate]',
  'data-open:pointer-events-auto data-open:translate-none data-open:opacity-100',
  '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,white_var(--fill),rgba(255,255,255,0.18)_var(--fill))] [&::-webkit-slider-runnable-track]:shadow-[inset_0_1px_1px_rgba(0,0,0,0.4)]',
  '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[linear-gradient(to_right,white_var(--fill),rgba(255,255,255,0.18)_var(--fill))]',
  '[&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.8)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110',
  '[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.8)]',
].join(' ');

/**
 * Apple's volume control: the speaker mutes, and hovering it slides the level
 * in where the other actions were (they fade out while it's open).
 */
function VolumeControl(props: { open: boolean; onOpen: () => void }) {
  const muted = () => playerStore.muted;
  const level = () => (muted() ? 0 : playerStore.volume);
  return (
    <>
      <input
        class={slider}
        data-open={props.open || undefined}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={level()}
        aria-label="Volume"
        tabIndex={props.open ? 0 : -1}
        style={{ '--fill': `${level() * 100}%` }}
        onInput={(e) => playerStore.setVolume(Number(e.currentTarget.value))}
      />
      <button
        class={action}
        aria-label={muted() ? 'Unmute' : 'Mute'}
        aria-pressed={muted()}
        onClick={() => playerStore.toggleMute()}
        onPointerEnter={props.onOpen}
        onFocus={props.onOpen}
      >
        <VolumeIcon level={level()} size={20} />
      </button>
    </>
  );
}

/** The floating glass player pill (report §1). */
export function PlayerBar() {
  const [volumeOpen, setVolumeOpen] = createSignal(false);
  let body!: HTMLDivElement;
  const songTint = useSongTint();
  const location = useLocation();
  const isSearch = () => location.pathname.startsWith('/search');
  const shouldShow = () => !isSearch() || !!playerStore.current;

  return (
    <Show when={uiStore.playerDock !== 'sidebar' && shouldShow()}>
      <footer
        // The side panel overlays the page; the pill re-centres in what's left.
        class="pointer-events-none absolute right-0 bottom-(--player-bottom-offset) left-(--web-navigation-width) z-[calc(var(--z-web-chrome)-1)] flex justify-center px-5 transition-[padding-inline-end] duration-(--duration-panel) ease-panel data-[panel-open=true]:pe-[calc(var(--side-panel-width)+20px)] max-sm:hidden"
        data-panel-open={uiStore.sidePanel !== null}
        data-player-pill
      >
        <div
          ref={body}
          data-dock-body
          style={songTint()}
          class="glass-pill group/pill pointer-events-auto relative grid h-(--player-pill-height) w-[min(668px,100%)] grid-cols-[184px_minmax(180px,427px)_minmax(57px,auto)] items-center rounded-pill px-4"
          role="region"
          aria-label="Player"
        >
          <span
            role="separator"
            aria-label="Drag into the sidebar to dock the player"
            title="Drag into the sidebar to dock the player"
            class="absolute top-1/2 left-0.5 grid h-9 w-3.5 -translate-y-1/2 cursor-grab touch-none place-items-center text-white/25 transition-colors hover:text-white/70 active:cursor-grabbing"
            onPointerDown={(event) => startDockDrag(event, body, (over) => over && uiStore.setPlayerDock('sidebar'))}
          >
            <GripVertical size={13} />
          </span>
          <div class="flex items-center justify-between pr-2">
            <button class={toggleBtn} aria-label="Shuffle" aria-pressed={playerStore.shuffle} onClick={() => playerStore.toggleShuffle()}>
              <ShuffleIcon size={28} />
            </button>
            <div class="flex items-center gap-1.5">
              <button class={transport} disabled={!playerStore.current} aria-label="Previous" onClick={() => playerStore.prev(false)}>
                <BackwardIcon size={26} />
              </button>
              <button
                class={transport}
                disabled={!playerStore.current}
                aria-label={playerStore.playing || playerStore.loading ? 'Pause' : 'Play'}
                onClick={() => playerStore.toggle()}
              >
                <Show when={playerStore.playing || playerStore.loading} fallback={<PlayIcon size={28} />}>
                  <PauseIcon size={28} />
                </Show>
              </button>
              <button
                class={transport}
                disabled={!playerStore.current || !(playerStore.index + 1 < playerStore.queue.length || playerStore.repeat !== 0 || playerStore.index >= 0)}
                aria-label="Next"
                onClick={() => playerStore.next(false)}
              >
                <ForwardIcon size={26} />
              </button>
            </div>
            <button
              class={toggleBtn}
              aria-label={playerStore.repeat === 2 ? 'Repeat one' : playerStore.repeat === 1 ? 'Repeat all' : 'Repeat'}
              aria-pressed={playerStore.repeat !== 0}
              onClick={() => playerStore.cycleRepeat()}
            >
              <Show when={playerStore.repeat === 2} fallback={<RepeatIcon size={28} />}>
                <RepeatOneIcon size={28} />
              </Show>
            </button>
          </div>

          <div class="h-full min-w-0 px-4">
            <Lcd />
          </div>

          <div
            class="group/actions relative flex items-center justify-end gap-[9px]"
            data-volume-open={volumeOpen() || undefined}
            onPointerLeave={() => setVolumeOpen(false)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setVolumeOpen(false);
            }}
          >
            <FavoriteButton track={playerStore.current} class={fading} />
            <button
              class={fading}
              aria-label="Lyrics"
              aria-pressed={uiStore.sidePanel === 'lyrics'}
              onClick={() => uiStore.toggleSidePanel('lyrics')}
            >
              <Show when={uiStore.sidePanel === 'lyrics'} fallback={<LyricsIcon size={18} />}>
                <LyricsActiveIcon size={18} />
              </Show>
            </button>
            <PlayerMenu class={fading} />
            <VolumeControl open={volumeOpen()} onOpen={() => setVolumeOpen(true)} />
          </div>
        </div>
      </footer>
    </Show>
  );
}

/**
 * The phone's player: a 52px glass band along the bottom (the pill is desktop
 * only, as Apple's web player is). The artwork opens the full-screen player;
 * play/pause rides along.
 */
export function MiniPlayer() {
  return (
    <Show when={playerStore.current} keyed>
      {(current) => (
        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-[calc(var(--z-web-chrome)-1)] sm:hidden">
          <div class="glass-pill pointer-events-auto relative grid h-(--mini-player-height) grid-cols-[1fr_auto] items-center gap-2 rounded-none px-3">
            <button
              class="flex min-w-0 items-center gap-2.5 text-start"
              aria-label="Open full screen player"
              onClick={() => playerStore.setFullscreen(true)}
            >
              <LcdArtwork track={current} />
              <span class="flex min-w-0 flex-col pb-1">
                <span class="type-body-emphasized">
                  <SongTitle
                    title={current.title}
                    href={current.albumId ? albumHref(current.albumId) : (current.album ? `/search?q=${encodeURIComponent(current.album)}&filter=albums` : undefined)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </span>
                <span class="truncate type-callout text-secondary">{(current.artists || []).map(cleanArtistDisplay).filter(Boolean).join(', ') || cleanArtistDisplay(current.channel || '')}</span>
              </span>
            </button>
            <button
              class="grid size-9 place-items-center rounded-full text-primary disabled:opacity-40"
              aria-label={playerStore.playing || playerStore.loading ? 'Pause' : 'Play'}
              onClick={() => playerStore.toggle()}
            >
              <Show when={playerStore.playing || playerStore.loading} fallback={<PlayIcon size={26} />}>
                <PauseIcon size={26} />
              </Show>
            </button>
            <MiniProgress />
          </div>
        </div>
      )}
    </Show>
  );
}

function LcdArtwork(props: { track: Track }) {
  const thumb = () => thumbCandidates(props.track)[0] ?? null;
  return (
    <span class="relative block size-[38px] flex-none overflow-hidden rounded-[6px] bg-joe artwork-stroke">
      <Show when={thumb()}>
        {(src) => (
          <img
            src={src()}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            class="size-full object-cover"
          />
        )}
      </Show>
    </span>
  );
}

function MiniProgress() {
  const { setBarRef, dragging, handlers } = useScrubberLocal();
  return (
    <div class="absolute inset-x-0 bottom-0 h-3 cursor-pointer touch-none" data-dragging={dragging() || undefined} {...handlers}>
      <div class="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-quaternary">
        <div ref={setBarRef} class="size-full origin-left scale-x-(--progress) bg-primary [--progress:0]" />
      </div>
    </div>
  );
}
