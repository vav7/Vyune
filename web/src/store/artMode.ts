import { createStore, unwrap } from 'solid-js/store';

/**
 * The 3 player presentation modes:
 * - 'art': Normal static high-resolution artwork
 * - 'visualiser': Dynamic visualizer cycling live album art -> 30s clips of all MV versions -> loop
 * - 'mv': Full official YouTube Music Video synchronized with audio playhead
 */
export type ArtMode = 'art' | 'visualiser' | 'mv';
export const ART_MODES: ArtMode[] = ['art', 'visualiser', 'mv'];
export const ART_MODE_LABEL: Record<ArtMode, string> = {
  art: 'Art mode',
  visualiser: 'Visualizer',
  mv: 'Music video',
};

const KEY = 'mc_artmode';
const read = (): ArtMode => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'art' || saved === 'visualiser' || saved === 'mv') return saved;
    if (saved === 'static') return 'art';
    if (saved === 'motion') return 'visualiser';
    return 'visualiser';
  } catch {
    return 'visualiser';
  }
};
const write = (mode: ArtMode) => {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // storage can be unavailable
  }
};

export interface ArtModeState {
  mode: ArtMode;
  setMode: (mode: ArtMode) => void;
  /** Tapping the poster: art → visualiser → mv → art. */
  cycle: () => ArtMode;
  /** The versions of the playing song's video (official, director's cut…), published by the poster. */
  versions: string[];
  versionIndex: number;
  setVersions: (labels: string[]) => void;
  setVersionIndex: (index: number) => void;
  /** The current visual state in visualizer mode (for UI indicators) */
  visualizerPhase: 'live_art' | 'mv_clip';
  setVisualizerPhase: (phase: 'live_art' | 'mv_clip') => void;
}

export const [artModeStore, setArtModeStore] = createStore<ArtModeState>({
  mode: read(),
  versions: [],
  versionIndex: 0,
  visualizerPhase: 'live_art',
  setVisualizerPhase: (visualizerPhase) => setArtModeStore({ visualizerPhase }),
  setVersions: (labels) =>
    setArtModeStore((state) =>
      state.versions.length === labels.length && state.versions.every((l, i) => l === labels[i])
        ? state
        : { versions: labels, versionIndex: 0 },
    ),
  setVersionIndex: (versionIndex) => setArtModeStore({ versionIndex }),
  setMode: (mode) => {
    write(mode);
    setArtModeStore({ mode });
  },
  cycle: () => {
    const next = ART_MODES[(ART_MODES.indexOf(artModeStore.mode) + 1) % ART_MODES.length]!;
    artModeStore.setMode(next);
    return next;
  },
});

/** The art-mode state as a plain object — for code that must not track. */
export function getArtModeState(): ArtModeState {
  return unwrap(artModeStore) as ArtModeState;
}

