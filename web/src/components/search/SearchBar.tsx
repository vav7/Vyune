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
      class="sr-field flex h-11 w-full max-w-[640px] items-center gap-1.5 rounded-pill bg-white/[0.14] [backdrop-filter:blur(40px)_saturate(200%)] pl-2 pr-2.5 shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.28),inset_0_1px_0_rgb(255_255_255/0.45),0_10px_30px_-10px_rgb(0_0_0/0.4)] transition-all focus-within:bg-white/[0.22] focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.65),0_14px_36px_-8px_rgb(0_0_0/0.5)]"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit(input.value);
        input.blur();
      }}
    >
      <button type="submit" class="grid size-9 flex-none place-items-center rounded-full text-secondary transition-colors hover:text-primary" aria-label="Search">
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
        class="min-w-0 flex-1 bg-transparent type-body text-primary outline-none placeholder:text-tertiary [&::-webkit-search-cancel-button]:hidden"
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <Show when={props.value}>
        <button
          type="button"
          class="grid size-7 flex-none place-items-center rounded-full bg-white/[0.2] text-primary/80 transition-colors hover:bg-white/[0.3]"
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
