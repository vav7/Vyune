import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Check, MoreHorizontal } from 'lucide-solid';
import { ART_MODES, artModeStore } from '@/store/artMode';
import { uiStore } from '@/store/ui';
import { ArtVolume } from './ArtControls';

const LABEL: Record<string, string> = {
  art: 'Static Artwork (Clean & Crisp)',
  motion: 'Apple Visualizer (Motion Art)',
  mv: 'Music Video (YouTube 1080p)',
};

/** The player's three dots: what the glass behind the art is made of, the Up Next list, and volume. */
export function PlayerMenu(props: {
  class?: string;
  up?: boolean;
  /** Overrides the side-panel Up Next toggle (the full-screen player has its own column). */
  upNext?: { active: () => boolean; toggle: () => void };
  showVolume?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;

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

  const upNextActive = () => (props.upNext ? props.upNext.active() : uiStore.sidePanel === 'up-next');

  return (
    <div ref={root} class="relative">
      <button class={props.class ?? ''} aria-label="More options" aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={18} />
      </button>
      <Show when={open()}>
        <div
          role="menu"
          class={`absolute right-0 z-[80] w-64 rounded-[14px] border border-white/12 bg-[rgb(18_18_18/0.88)] p-1.5 shadow-[0_24px_60px_-14px_#000e] [backdrop-filter:blur(26px)_saturate(1.6)] animate-[fade-in_140ms_ease-out_both] ${(props.up ?? true) ? 'bottom-full mb-3' : 'top-full mt-2'}`}
        >
          <p class="px-3 pt-1.5 pb-1 type-[700_10px/14px] tracking-[0.16em] text-tertiary uppercase">Background</p>
          <For each={ART_MODES}>
            {(item) => (
              <button
                role="menuitemradio"
                aria-checked={artModeStore.mode === item}
                class="flex h-9 w-full items-center justify-between rounded-[9px] px-3 text-left type-[500_13px/18px] text-white hover:bg-white/10"
                onClick={() => artModeStore.setMode(item)}
              >
                {LABEL[item]}
                <Show when={artModeStore.mode === item}>
                  <Check size={15} aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
          <Show when={artModeStore.mode === 'mv' && artModeStore.versions.length > 1}>
            <>
              <div class="my-1.5 h-px bg-white/10" />
              <p class="px-3 pt-1.5 pb-1 type-[700_10px/14px] tracking-[0.16em] text-tertiary uppercase">Video version</p>
              <For each={artModeStore.versions}>
                {(label, index) => (
                  <button
                    role="menuitemradio"
                    aria-checked={artModeStore.versionIndex === index()}
                    class="flex h-9 w-full items-center justify-between rounded-[9px] px-3 text-left type-[500_13px/18px] text-white hover:bg-white/10"
                    onClick={() => artModeStore.setVersionIndex(index())}
                  >
                    {label}
                    <Show when={artModeStore.versionIndex === index()}>
                      <Check size={15} aria-hidden="true" />
                    </Show>
                  </button>
                )}
              </For>
            </>
          </Show>
          <div class="my-1.5 h-px bg-white/10" />
          <button
            role="menuitemcheckbox"
            aria-checked={upNextActive()}
            class="flex h-9 w-full items-center justify-between rounded-[9px] px-3 text-left type-[500_13px/18px] text-white hover:bg-white/10"
            onClick={() => {
              if (props.upNext) props.upNext.toggle();
              else uiStore.toggleSidePanel('up-next');
              setOpen(false);
            }}
          >
            Up Next / Autoplay list
            <Show when={upNextActive()}>
              <Check size={15} aria-hidden="true" />
            </Show>
          </button>
          <Show when={props.showVolume ?? true}>
            <div class="px-3 pt-2 pb-1.5">
              <ArtVolume />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
