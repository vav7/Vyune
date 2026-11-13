import { For, Show, createSignal } from 'solid-js';
import { Infinity as InfinityIcon, MoreHorizontal, X } from 'lucide-solid';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { Artwork } from '@/components/music/Artwork';
import { formatDuration } from '@/components/music/links';
import type { Track } from '@/lib/types';
import { playerStore } from '@/store/player';

// The panel's square buttons: AutoPlay (the key colour when on) and the options menu.
const square = 'grid size-7 place-items-center rounded-[6px] text-secondary hover:bg-quinary aria-pressed:text-key';
const list = 'flex flex-col';

/** A row: 55px, [art] 40px [title] 1fr [right] 40px, gap 12px, radius 6px; a key-colour line where a drag would drop. */
function Row(props: {
  track: Track;
  at: number;
  onDragStart: (at: number) => void;
  onDropAt: (at: number) => void;
  dragging: boolean;
}) {
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  const [over, setOver] = createSignal(false);
  const close = () => setAnchor(null);

  return (
    <li
      class="track-row group/row relative grid h-[55px] grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-x-3 rounded-row px-2.5 hover:bg-quinary data-dragging:opacity-40 data-over:before:absolute data-over:before:inset-x-2.5 data-over:before:-top-px data-over:before:border-t-2 data-over:before:border-t-key"
      data-over={over() || undefined}
      data-dragging={props.dragging || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer!.effectAllowed = 'move';
        props.onDragStart(props.at);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        props.onDropAt(props.at);
      }}
      onDblClick={() => playerStore.jump(props.at)}
    >
      <div class="relative size-10">
        <Artwork src={props.track.thumb} track={props.track} displayWidth={40} radius="var(--radius-artwork-small)" />
        {/* The ✕ over the artwork's top-left, on hover. */}
        <button
          class="absolute -top-1.5 -left-1.5 hidden size-[22px] place-items-center rounded-full bg-thick-material text-primary shadow-[0_1px_3px_#0004] [backdrop-filter:blur(10px)] group-hover/row:grid"
          aria-label={`Remove ${props.track.title}`}
          onClick={() => playerStore.removeFromQueue(props.at)}
        >
          <X size={12} strokeWidth={3} />
        </button>
      </div>
      <button
        class="flex min-w-0 flex-col text-start"
        onClick={() => playerStore.jump(props.at)}
        aria-label={`Play ${props.track.title}`}
      >
        <span class="truncate type-body text-primary">{props.track.title}</span>
        <span class="truncate type-body text-secondary">{(props.track.artists || []).join(', ')}</span>
      </button>
      <div class="relative grid items-center justify-items-end">
        <span class="type-body tabular-nums text-secondary group-hover/row:invisible group-has-[[data-open]]/row:invisible">
          {formatDuration(props.track.duration)}
        </span>
        <button
          class="absolute inset-y-0 right-0 my-auto hidden size-7 place-items-center rounded-full text-key group-hover/row:grid data-open:grid"
          aria-label={`More options for ${props.track.title}`}
          aria-haspopup="menu"
          data-open={anchor() !== null || undefined}
          onClick={(e) => setAnchor(anchor() ? null : e.currentTarget)}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      <Show when={anchor()}>
        <Menu anchor={anchor()!} onClose={close} label={props.track.title}>
          <MenuItem onSelect={() => (close(), playerStore.jump(props.at))}>Play Now</MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              playerStore.removeFromQueue(props.at);
              playerStore.enqueueNext(props.track);
            }}
          >
            Play Next
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => (close(), playerStore.removeFromQueue(props.at))}>
            Remove from Up Next
          </MenuItem>
        </Menu>
      </Show>
    </li>
  );
}

const SLEEP_CHOICES = [15, 30, 60] as const;

/** Apple's Up Next (report §7), over the two-tier queue: what's next, then AutoPlay's section. */
export function UpNext(props: { embedded?: boolean }) {
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const close = () => setAnchor(null);

  const canClear = () => playerStore.index >= 0 && playerStore.index + 1 < playerStore.queue.length;
  const upcoming = () =>
    playerStore.queue
      .map((track, at) => ({ track, at }))
      .filter(({ at }) => at > playerStore.index);
  const split = () => (playerStore.autoStart != null ? playerStore.autoStart : playerStore.queue.length);
  const beforeAutoplay = () => upcoming().filter(({ at }) => at < split());
  const afterAutoplay = () => upcoming().filter(({ at }) => at >= split());
  const sleepMinutes = () =>
    playerStore.sleepUntil ? Math.max(1, Math.round((playerStore.sleepUntil - Date.now()) / 60_000)) : null;

  const rows = (items: { track: Track; at: number }[]) => (
    <For each={items}>
      {({ track, at }) => (
        <Row
          track={track}
          at={at}
          dragging={dragFrom() === at}
          onDragStart={setDragFrom}
          onDropAt={(to) => {
            const from = dragFrom();
            if (from !== null) playerStore.moveInQueue(from, to);
            setDragFrom(null);
          }}
        />
      )}
    </For>
  );

  return (
    <>
      <div class={props.embedded ? 'flex items-center gap-1.5 pb-3' : 'flex items-center gap-1.5 px-5 pt-[23px] pb-3'}>
        <h3 class="flex-1 type-title-2-emphasized">Up Next</h3>
        <Show when={canClear()}>
          <button class="mr-1 type-title-3 text-key" onClick={() => playerStore.clearQueue()}>
            Clear
          </button>
        </Show>
        <button
          class={square}
          aria-label="AutoPlay"
          title="AutoPlay: keep playing similar music when the queue ends"
          aria-pressed={playerStore.autoDj}
          onClick={() => playerStore.setAutoDj(!playerStore.autoDj)}
        >
          <InfinityIcon size={16} strokeWidth={2.4} />
        </button>
        <button class={square} aria-label="Playback options" aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)}>
          <MoreHorizontal size={16} />
        </button>
        <Show when={anchor()}>
          <Menu anchor={anchor()!} onClose={close} label="Playback options">
            <MenuHeader>Sleep Timer</MenuHeader>
            <For each={SLEEP_CHOICES}>
              {(minutes) => (
                <MenuItem
                  checked={sleepMinutes() != null && Math.abs(sleepMinutes()! - minutes) <= 1}
                  onSelect={() => (close(), playerStore.setSleepTimer(minutes))}
                >
                  {minutes} minutes
                </MenuItem>
              )}
            </For>
            <MenuItem checked={playerStore.sleepUntil === null} onSelect={() => (close(), playerStore.setSleepTimer(null))}>
              Off
            </MenuItem>
          </Menu>
        </Show>
      </div>

      <Show
        when={upcoming().length > 0}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-20 text-center type-callout text-secondary">
            <p class="type-callout-emphasized">Nothing in Up Next</p>
            <p>
              {playerStore.autoDj && playerStore.repeat === 0 && playerStore.index >= 0
                ? 'AutoPlay is finding similar music.'
                : 'Songs you play next appear here.'}
            </p>
          </div>
        }
      >
        <div class={`min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-width:thin] ${props.embedded ? 'pb-10' : 'pb-[120px]'}`}>
          <ol class={list}>{rows(beforeAutoplay())}</ol>
          <Show when={afterAutoplay().length > 0}>
            <>
              <h4 class="mx-2.5 mt-[18px] mb-0.5 flex items-center gap-1.5 type-callout-emphasized">
                <InfinityIcon size={14} strokeWidth={2.4} /> AutoPlay
              </h4>
              <p class="mx-2.5 mb-2 type-callout text-secondary">Similar music, from YouTube Music’s radio.</p>
              <ol class={list}>{rows(afterAutoplay())}</ol>
            </>
          </Show>
        </div>
      </Show>
    </>
  );
}
