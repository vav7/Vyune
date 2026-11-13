import { Show } from 'solid-js';
import { Marquee } from './Marquee';

/**
 * Splits "Song Name (feat. X)" / "Song - Remastered" into the name and its tail.
 * The name is the song; the tail is decoration, so only the tail is allowed to move.
 */
export function splitTitle(title: string): { main: string; tail: string } {
  const text = (title || '').trim();
  const m = text.match(/\s+(?=[(\[]|[-–—]\s|(?:feat|ft|featuring|with|from|prod)\b\.?\s)/i);
  if (!m || m.index === undefined || m.index < 2) return { main: text, tail: '' };
  return { main: text.slice(0, m.index).trimEnd(), tail: text.slice(m.index).trim() };
}

/**
 * The song title on one line. The song's own name sits still (with an ellipsis if it is longer than
 * the room); a "(feat. …)" / "- …" tail after it slides right to left when it does not fit.
 */
export function SongTitle(props: { title: string; class?: string; tailClass?: string }) {
  const parts = () => splitTitle(props.title);
  return (
    <Show
      when={parts().tail}
      fallback={<span class={`block min-w-0 truncate ${props.class ?? ''}`}>{props.title}</span>}
    >
      <span class={`flex min-w-0 items-baseline gap-[0.3em] ${props.class ?? ''}`}>
        <span class="min-w-0 flex-none truncate" style={{ 'max-width': '70%' }}>{parts().main}</span>
        <Marquee class={`min-w-0 flex-1 opacity-70 ${props.tailClass ?? ''}`} render={() => <span>{parts().tail}</span>} />
      </span>
    </Show>
  );
}
