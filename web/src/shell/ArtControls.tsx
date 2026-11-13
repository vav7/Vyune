import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Check, MoreHorizontal, Volume1, Volume2, VolumeX } from 'lucide-solid';
import { ART_MODES, ART_MODE_LABEL, artModeStore } from '@/store/artMode';
import { playerStore } from '@/store/player';

/** The poster's corner menu: static artwork, motion artwork or the music video. */
export function ArtModeMenu() {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;

  // While the menu is open, a click elsewhere or Escape closes it.
  createEffect(() => {
    if (!open()) return;
    const away = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    });
  });

  return (
    <div ref={root} class="absolute top-2 right-2 z-20" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label="Artwork options"
        aria-haspopup="menu"
        aria-expanded={open()}
        class="grid size-9 place-items-center rounded-full bg-black/35 text-white opacity-0 [backdrop-filter:blur(14px)] transition-[opacity,background-color] duration-200 group-hover/poster:opacity-100 hover:bg-black/55 focus-visible:opacity-100 max-md:opacity-100 aria-expanded:opacity-100"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} />
      </button>
      <Show when={open()}>
        <div
          role="menu"
          class="absolute top-11 right-0 w-52 overflow-hidden rounded-[12px] border border-white/12 bg-[rgb(26_26_32/0.82)] p-1 shadow-[0_18px_44px_-10px_#000c] [backdrop-filter:blur(26px)_saturate(1.6)] animate-[fade-in_140ms_ease-out_both]"
        >
          <For each={ART_MODES}>
            {(item) => (
              <button
                role="menuitemradio"
                aria-checked={artModeStore.mode === item}
                class="flex h-9 w-full items-center justify-between rounded-[8px] px-3 text-left type-[500_14px/20px] text-white hover:bg-white/12"
                onClick={() => {
                  artModeStore.setMode(item);
                  setOpen(false);
                }}
              >
                {ART_MODE_LABEL[item]}
                <Show when={artModeStore.mode === item}>
                  <Check size={15} aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Speaker (mutes) and a level line, for the art mode. */
export function ArtVolume() {
  const muted = () => playerStore.muted;
  const level = () => (muted() ? 0 : playerStore.volume);
  return (
    <div class="flex w-full max-w-[320px] items-center gap-3">
      <button
        type="button"
        class="grid size-8 flex-none place-items-center rounded-full text-secondary transition-colors hover:bg-white/10 hover:text-primary"
        aria-label={muted() ? 'Unmute' : 'Mute'}
        onClick={() => playerStore.toggleMute()}
      >
        <Show when={level() === 0} fallback={<Show when={level() < 0.5} fallback={<Volume2 size={18} />}><Volume1 size={18} /></Show>}>
          <VolumeX size={18} />
        </Show>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={level()}
        aria-label="Volume"
        class="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/18 accent-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        style={{ background: `linear-gradient(90deg,#fff ${level() * 100}%,rgba(255,255,255,.18) ${level() * 100}%)` }}
        onInput={(event) => playerStore.setVolume(Number(event.currentTarget.value))}
      />
    </div>
  );
}
