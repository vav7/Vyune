import { Show } from 'solid-js';
import { Marquee } from './Marquee';
import { PrefetchLink } from '@/components/PrefetchLink';

/**
 * Splits "Song Name (feat. X)" / "Song - Remastered" into the main song name and its tail.
 * The main song name sits still; only the tail is allowed to marquee/move when overflowing.
 */
export function splitTitle(title: string): { main: string; tail: string } {
  const text = (title || '').trim();
  const m = text.match(/\s*(?=[(\[]|[-–—|:]\s*|(?:feat|ft|featuring|with|from|prod|produced by|part|pt)\b\.?\s*)/i);
  if (!m || m.index === undefined || m.index < 2) return { main: text, tail: '' };
  return { main: text.slice(0, m.index).trimEnd(), tail: text.slice(m.index).trim() };
}

/**
 * The song title on one line. The song's own name sits still (anchored, with an ellipsis if it
 * is longer than the room); a "(feat. …)" / "- …" tail after it slides right to left when it does not fit.
 */
export function SongTitle(props: {
  title: string;
  href?: string | null;
  class?: string;
  tailClass?: string;
}) {
  const parts = () => splitTitle(props.title);

  const renderMain = (text: string) => (
    <Show when={props.href} fallback={<span class="truncate">{text}</span>}>
      <PrefetchLink to={props.href!} class="truncate hover:underline">
        {text}
      </PrefetchLink>
    </Show>
  );

  return (
    <Show
      when={parts().tail}
      fallback={
        <span class={`block min-w-0 truncate ${props.class ?? ''}`}>
          {renderMain(props.title)}
        </span>
      }
    >
      <span class={`flex min-w-0 items-center gap-[0.25em] overflow-hidden ${props.class ?? ''}`}>
        <span class="min-w-0 shrink-0 truncate max-w-[75%] text-inherit font-inherit text-[length:inherit] leading-[inherit]">
          {renderMain(parts().main)}
        </span>
        <Marquee
          class={`min-w-0 flex-1 text-inherit font-inherit text-[length:inherit] leading-[inherit] ${props.tailClass ?? ''}`}
          render={() => (
            <Show when={props.href} fallback={<span class="text-inherit font-inherit">{parts().tail}</span>}>
              <PrefetchLink to={props.href!} class="truncate hover:underline text-inherit font-inherit">
                {parts().tail}
              </PrefetchLink>
            </Show>
          )}
        />
      </span>
    </Show>
  );
}
