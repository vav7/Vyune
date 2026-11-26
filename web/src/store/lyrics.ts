import { createStore } from 'solid-js/store';
import { persistSlice, readLS, writeLS } from './persist';

/** Per-song lyrics provider pick. The key is the same identity the lyrics query uses. */
export type LyricsPick = {
  source: string | null; // null = "Best available"
  retry: number;
  forceRefresh: boolean;
  upgradeAttempt: number;
};

const DEFAULT_PICK: LyricsPick = { source: null, retry: 0, forceRefresh: false, upgradeAttempt: 0 };
const KEY = 'vyune-lyrics-picks';
const OFFSET_KEY = 'vyune-lyrics-offset';
const TRANS_KEY = 'vyune-lyrics-translation';
const ROMAN_KEY = 'vyune-lyrics-romanization';

export interface LyricsStore {
  /** The picks, keyed by song identity. */
  picks: Record<string, LyricsPick>;
  syncOffsetMs: number;
  showTranslation: boolean;
  showRomanization: boolean;
  getPick: (key: string) => LyricsPick;
  setPick: (key: string, patch: Partial<LyricsPick>) => void;
  clearPick: (key: string) => void;
  setSyncOffset: (offset: number) => void;
  setShowTranslation: (on: boolean) => void;
  setShowRomanization: (on: boolean) => void;
}

/**
 * Shared across the full-screen player and the side lyrics panel.
 * Persisted so a reload keeps the user's choice.
 */
export const [lyricsStore, setLyricsStore] = createStore<LyricsStore>({
  picks: readLS<Record<string, LyricsPick>>(KEY, {}),
  syncOffsetMs: readLS<number>(OFFSET_KEY, 0),
  showTranslation: readLS<boolean>(TRANS_KEY, true),
  showRomanization: readLS<boolean>(ROMAN_KEY, false),

  getPick: (key) => lyricsStore.picks[key] ?? DEFAULT_PICK,

  setPick: (key, patch) =>
    setLyricsStore('picks', key, (current) => ({ ...(current ?? DEFAULT_PICK), ...patch })),

  clearPick: (key) => setLyricsStore('picks', key, undefined!),

  setSyncOffset: (offset) => {
    setLyricsStore('syncOffsetMs', offset);
    writeLS(OFFSET_KEY, offset);
  },

  setShowTranslation: (on) => {
    setLyricsStore('showTranslation', on);
    writeLS(TRANS_KEY, on);
  },

  setShowRomanization: (on) => {
    setLyricsStore('showRomanization', on);
    writeLS(ROMAN_KEY, on);
  },
});

persistSlice(
  KEY,
  () => lyricsStore.picks,
  (value) => writeLS(KEY, value),
  600,
);
