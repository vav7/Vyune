/* SearchBar.tsx — SearchField: one pill with the magnifier as the
 * submit button on the left, the text in the middle, and a clear (×) on the
 * right that appears once there is something to clear. Return submits too. */

import { createEffect, on, onMount, Show } from 'solid-js';
import { SearchIcon } from '@/components/icons/NavIcons';

export function SearchBar(props: {
  value: string;
  onInput: (text: string) => void;
  onSubmit: (text: string) => void;
  onClear: () => void;
  autofocus?: boolean;
}) {
  let input!: HTMLInputElement;
  onMount(() => {
    if (props.autofocus) input.focus();
  });
  // Keep the DOM value honest when the text is changed from outside (a tapped
  // suggestion, a history row): never overwrite while the user is mid-typing it.
  createEffect(on(() => props.value, (value) => {
    if (input && input.value !== value) input.value = value;
  }));

  return (
    <form
      role="search"
      class="sr-field glance flex h-12 w-full max-w-[640px] items-center gap-2.5 rounded-full bg-black/40 backdrop-blur-[24px] backdrop-saturate-[1.9] border border-white/18 px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_16px_36px_-8px_rgba(0,0,0,0.65)] transition-all duration-300 focus-within:bg-black/55 focus-within:border-white/35 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_20px_48px_-8px_rgba(0,0,0,0.8),0_0_0_2px_rgba(255,255,255,0.18)]"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit(input.value);
        input.blur();
      }}
    >
      <button type="submit" class="grid size-9 flex-none place-items-center rounded-full text-secondary transition-colors hover:text-primary active:scale-95" aria-label="Search">
        <SearchIcon size={18} />
      </button>
      <input
        ref={input}
        type="search"
        value={props.value}
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="Search songs, artists, albums…"
        class="min-w-0 flex-1 bg-transparent type-body text-white placeholder:text-white/40 outline-none [&::-webkit-search-cancel-button]:hidden"
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <Show when={props.value}>
        <button
          type="button"
          class="grid size-7 flex-none place-items-center rounded-full bg-white/[0.12] hover:bg-white/[0.22] text-white/90 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-all active:scale-90"
          aria-label="Clear search"
          onClick={() => {
            props.onClear();
            input.focus();
          }}
        >
          <svg viewBox="0 0 12 12" class="size-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
        </button>
      </Show>
    </form>
  );
}
