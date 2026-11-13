import { createStore, unwrap } from 'solid-js/store';

/** The picture the page is currently frosted with (set by pages, drawn once by the layout). */
export interface PageArt {
  url: string | null;
  /** How light the picture is (0–1); pale posters get a deeper veil. */
  lum: number;
  /** An explicit veil strength (0–1) for pages that want their own. */
  dim?: number;
  palette?: string[];
  set: (art: { url: string | null; lum?: number; dim?: number; palette?: string[] }) => void;
}

export const [pageArtStore, setPageArtStore] = createStore<PageArt>({
  url: null,
  lum: 0,
  dim: undefined,
  palette: undefined,
  set: ({ url, lum = 0, dim, palette }) => setPageArtStore({ url, lum, dim, palette }),
});

/** The page artwork as a plain object — for code that must not track. */
export function getPageArtState(): PageArt {
  return unwrap(pageArtStore) as PageArt;
}
