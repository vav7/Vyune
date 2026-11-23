import { Show } from 'solid-js';
import { SongTitle } from '@/components/music/SongTitle';
import { albumHref } from '@/components/music/links';
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
} from '@/components/icons/Transport';
import { AppleMotionArtwork } from '@/components/music/AppleMotionArtwork';
import { sizedArtwork } from '@/lib/artwork';
import { artModeStore } from '@/store/artMode';
import { cleanArtistDisplay } from '@/lib/artistCredits';
import { thumbCandidates, playerStore } from '@/store/player';
import { uiStore } from '@/store/ui';
import { useSongTint } from '@/lib/useSongTint';
import { ArtVolume } from './ArtControls';
import { startDockDrag } from './dock';
import { PlayerMenu } from './PlayerMenu';

const button = 'grid size-9 place-items-center rounded-full text-primary/90 transition-all duration-200 hover:bg-white/14 hover:scale-105 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:text-primary active:scale-90 disabled:opacity-40 aria-pressed:text-key';

/**
 * The player, docked at the bottom of the sidebar in three chunks: the
 * transport buttons; the artwork with title, artist and a one-line lyric; and
 * volume with the lyrics and options buttons. Drag the grip out of the
 * sidebar to throw it back to the floating bar.
 */
export function SidebarPlayer() {
  const songTintStyle = useSongTint();

  return (
    <Show when={uiStore.playerDock === 'sidebar' && playerStore.current} keyed>
      {(current) => {
        const thumb = thumbCandidates(current)[0] ?? null;
        return (
          <div data-dock-body style={songTintStyle()} class="relative mx-3 mb-3 flex flex-col gap-1.5 will-change-transform">
            <div
              role="separator"
              aria-label="Drag out of the sidebar to return the player to the bar"
              title="Drag out of the sidebar to return the player to the bar"
              class="grid h-4 cursor-grab touch-none place-items-center active:cursor-grabbing"
              onPointerDown={(event) => startDockDrag(event, undefined, (over) => !over && uiStore.setPlayerDock('bar'))}
            >
              <span class="h-1 w-9 rounded-full bg-white/30" />
            </div>

            <div class="glass-card song-glass flex items-center justify-between rounded-[20px] px-2 py-1.5">
              <button class={button} aria-label="Shuffle" aria-pressed={playerStore.shuffle} onClick={() => playerStore.toggleShuffle()}>
                <ShuffleIcon size={22} />
              </button>
              <button class={button} aria-label="Previous" onClick={() => playerStore.prev(false)}>
                <BackwardIcon size={22} />
              </button>
              <button
                class={`${button} size-10`}
                aria-label={playerStore.playing || playerStore.loading ? 'Pause' : 'Play'}
                onClick={() => playerStore.toggle()}
              >
                <Show when={playerStore.playing || playerStore.loading} fallback={<PlayIcon size={26} />}>
                  <PauseIcon size={26} />
                </Show>
              </button>
              <button class={button} aria-label="Next" onClick={() => playerStore.next(false)}>
                <ForwardIcon size={22} />
              </button>
              <button class={button} aria-label="Repeat" aria-pressed={playerStore.repeat !== 0} onClick={() => playerStore.cycleRepeat()}>
                <Show when={playerStore.repeat === 2} fallback={<RepeatIcon size={22} />}>
                  <RepeatOneIcon size={22} />
                </Show>
              </button>
            </div>

            <div class="glass-card song-glass flex items-center gap-3 rounded-[20px] p-2.5">
              <button
                class="relative size-14 flex-none overflow-hidden rounded-[6px] bg-joe artwork-stroke"
                aria-label="Open full screen player"
                onClick={() => playerStore.setFullscreen(true)}
              >
                <Show when={thumb}>
                  {(src) => <img src={sizedArtwork(src(), 112)} alt="" referrerPolicy="no-referrer" decoding="async" class="size-full object-cover" />}
                </Show>
                <Show when={artModeStore.mode !== 'art'}>
                  <AppleMotionArtwork track={current} mode={artModeStore.mode} />
                </Show>
              </button>
              <div class="min-w-0 flex-1">
                <p class="type-[700_13px/18px] [font-family:var(--font-display)]">
                  <SongTitle
                    title={current.title}
                    href={current.albumId ? albumHref(current.albumId) : (current.album ? `/search?q=${encodeURIComponent(current.album)}&filter=albums` : undefined)}
                  />
                </p>
                <p class="truncate type-[500_12px/16px] text-secondary">{(current.artists || []).map(cleanArtistDisplay).filter(Boolean).join(', ') || cleanArtistDisplay(current.channel || '')}</p>
              </div>
            </div>

            <div class="glass-card song-glass flex flex-col gap-1 rounded-[20px] px-3 py-2">
              <ArtVolume />
              <div class="flex items-center justify-between">
                <button
                  class={button}
                  aria-label="Lyrics"
                  aria-pressed={uiStore.sidePanel === 'lyrics'}
                  onClick={() => uiStore.toggleSidePanel('lyrics')}
                >
                  <Show when={uiStore.sidePanel === 'lyrics'} fallback={<LyricsIcon size={18} />}>
                    <LyricsActiveIcon size={18} />
                  </Show>
                </button>
                <button
                  class="rounded-full px-3 py-1.5 type-[600_12px/16px] text-secondary transition-colors hover:bg-white/10 hover:text-primary"
                  onClick={() => uiStore.setPlayerDock('bar')}
                >
                  Return to bar
                </button>
                <PlayerMenu class={button} />
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
