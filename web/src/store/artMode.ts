import { createStore, unwrap } from 'solid-js/store';

/** What lives behind and on the player's poster. */
export type ArtMode = 'static' | 'motion' | 'mv';
export const ART_MODES: ArtMode[] = ['static', 'motion', 'mv'];
export const ART_MODE_LABEL: Record<ArtMode, string> = {
  static: 'Static artwork',
  motion: 'Motion artwork',
  mv: 'Music video',
};

const KEY = 'mc_artmode';
const read = (): ArtMode => {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'static' || saved === 'motion' || saved === 'mv' ? saved : 'motion';
  } catch {
    return 'motion';
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
  /** Tapping the poster: static → motion → music video → static. */
  cycle: () => ArtMode;
  /** The versions of the playing song's video (official, director's cut…), published by the poster. */
  versions: string[];
  versionIndex: number;
  setVersions: (labels: string[]) => void;
  setVersionIndex: (index: number) => void;
}

export const [artModeStore, setArtModeStore] = createStore<ArtModeState>({
  mode: read(),
  versions: [],
  versionIndex: 0,
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
