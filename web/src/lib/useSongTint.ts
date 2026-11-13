import type { JSX } from 'solid-js';
import { useArtworkColor } from './artworkColor';
import { playerStore, thumbCandidates } from '@/store/player';

/**
 * The playing song's colour as a `--song-tint` custom property, for glass that
 * takes its tone from the artwork (the player pill, the docked player).
 *
 * Returns an accessor: the colour is measured after the artwork decodes, so
 * the style object has to be read where it is used.
 */
export function useSongTint(): () => JSX.CSSProperties {
  const color = useArtworkColor(() => {
    const current = playerStore.current;
    return current ? (thumbCandidates(current)[0] ?? null) : null;
  });
  return () => {
    const sampled = color();
    const tint = sampled?.palette?.[0] ?? sampled?.background;
    return (tint ? { '--song-tint': tint } : {}) as JSX.CSSProperties;
  };
}
