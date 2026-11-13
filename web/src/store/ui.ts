import { createStore, unwrap } from 'solid-js/store';

export type SidePanel = 'up-next' | 'lyrics' | null;

export interface UiState {
  /** The right-hand glass panel (report §7); one of Up Next or Lyrics at a time. */
  sidePanel: SidePanel;
  toggleSidePanel: (panel: Exclude<SidePanel, null>) => void;
  closeSidePanel: () => void;
  /** The sidebar as a drawer, below 484px where it's otherwise hidden. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** The lyrics as a free window (position of its top-left corner), or null while docked. */
  lyricsFloat: { x: number; y: number } | null;
  setLyricsFloat: (pos: { x: number; y: number } | null) => void;
  /** Where the player lives: the floating bar, or docked at the bottom of the sidebar. */
  playerDock: 'bar' | 'sidebar';
  setPlayerDock: (dock: 'bar' | 'sidebar') => void;
  /** The desktop sidebar can be tucked away. */
  sidebarHidden: boolean;
  toggleSidebar: () => void;
}

const readLS = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (v as unknown as T);
  } catch {
    return fallback;
  }
};
const writeLS = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // storage can be unavailable
  }
};

export const [uiStore, setUiStore] = createStore<UiState>({
  sidePanel: null,
  toggleSidePanel: (panel) => setUiStore((s) => ({ sidePanel: s.sidePanel === panel ? null : panel })),
  closeSidePanel: () => setUiStore({ sidePanel: null }),
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => setUiStore({ drawerOpen }),
  playerDock: readLS<string>('mc_player_dock', 'bar') === 'sidebar' ? 'sidebar' : 'bar',
  setPlayerDock: (playerDock) => {
    writeLS('mc_player_dock', playerDock);
    setUiStore({ playerDock });
  },
  lyricsFloat: null,
  setLyricsFloat: (lyricsFloat) => setUiStore({ lyricsFloat }),
  sidebarHidden: readLS<string>('mc_sidebar_hidden', '0') === '1',
  toggleSidebar: () => {
    const next = !uiStore.sidebarHidden;
    writeLS('mc_sidebar_hidden', next ? '1' : '0');
    setUiStore({ sidebarHidden: next });
  },
});

/** The UI state as a plain object — for code that must not track. */
export function getUiState(): UiState {
  return unwrap(uiStore) as UiState;
}

// For browser-driven tests, next to __mcPlayer.
if (process.env.NODE_ENV !== 'production') Object.assign(window, { __mcUi: uiStore });
