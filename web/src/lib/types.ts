/* Shared domain types — mirror the server DTOs exactly */

export interface Track {
  id: string;
  source: 'yt' | 'saavn';
  title: string;
  artists: string[];
  artistIds?: string[];
  album?: string | null;
  albumId?: string | null;
  duration: number; // seconds (0 = unknown; filled from audio metadata)
  thumb?: string | null;
  explicit?: boolean;
  trackNumber?: number;
  year?: number | null;
  playCount?: number;
  language?: string | null;
  /** The channel that published the row (YouTube only). */
  channel?: string | null;
  /**
   * Somebody's upload rather than the catalogue's own recording of the song.
   * The server resolves these through the catalogue before playing them.
   */
  isUpload?: boolean;
  /** A music-video result from search (not a catalogue song). */
  isVideo?: boolean;
}

export interface Card {
  id: string;
  kind?: 'playlist' | 'radio' | string;
  title: string;
  subtitle?: string | null;
  thumb?: string | null;
  /** Monthly audience or subscribers, parsed by the server (artist cards). */
  audience?: number | null;
}

export interface Playlist {
  id: string;
  title: string;
  subtitle?: string | null;
  thumb?: string | null;
  tracks: Track[];
  /** The server has only sent page one of a long list; the rest follows. */
  partial?: boolean;
}

export interface GenreCategory {
  label: string;
  params: string;
}

export interface DiscoItem extends Card {
  year?: number | null;
  type?: string | null;
}

export interface ArtistPage {
  id: string;
  name: string;
  description?: string | null;
  subscribers?: string | null;
  listeners?: string | null;
  thumb?: string | null;
  radioId?: string | null;
  topSongs: Track[];
  sections: { title: string; items: Card[] }[];
  similar: Card[];
  discography?: DiscoItem[];
}

export interface AlbumPage {
  id: string;
  title: string;
  subtitle?: string | null;
  year?: string | null;
  thumb?: string | null;
  description?: string | null;
  artists: { name: string; id?: string }[];
  tracks: Track[];
}

export interface Syllable {
  text: string;
  part: boolean;
  timestamp: number;
  endtime: number;
  romanizedText?: string;
  lineSynced?: boolean;
}

export interface LyricsLine {
  text: Syllable[];
  background: boolean;
  backgroundText: Syllable[];
  oppositeTurn: boolean;
  timestamp: number;
  endtime: number;
  isWordSynced?: boolean;
  alignment?: 'start' | 'end';
  songPart?: string;
  romanizedText?: string;
  translation?: string;
  agentId?: string;
  direction?: 'ltr' | 'rtl';
  /** A plain sheet's section heading ("Verse 1"), kept apart from the words. */
  section?: boolean;
}

export interface LyricsPrimary {
  source: string;
  lines: LyricsLine[];
  isWordSynced: boolean;
  /** Words only, with line times spread over the song by length: nothing better exists. */
  estimated?: boolean;
  isSynced: boolean;
  songwriters?: string | null;
  isrc?: string | null;
}

export interface LyricsResult {
  status: 'ok' | 'none';
  /** The server answered with its first sheet and is still hunting for word timing. */
  upgrading?: boolean;
  primary?: LyricsPrimary;
  alternates?: { source: string; tier: 'word' | 'line' | 'plain' }[];
  negative?: boolean;
  /** 'source' — the named provider has no lyrics for this song. */
  reason?: 'source';
  source?: string;
}

export interface SearchResult {
  query: string;
  corrected?: string | null;
  type?: string;
  results: Track[] | Card[];
}

export interface StreamResult {
  url: string;
  /** Same-origin range proxy for providers whose media URLs reject browser requests. */
  proxy?: string;
  source: 'yt' | 'saavn';
  mime?: string;
  bitrate?: number;
}

/**
 * Apple's own artist banner (server/appleart.js): the wide picture that
 * fills the top of their page, the title logo typeset over it, and the
 * looping motion clip that stands in for the still. Every part is optional —
 * most artists have no logo, and many have no clip.
 */
export interface AppleArtistArt {
  /** True when more of the banner is still on its way; the client comes back. */
  transient?: boolean;
  /** Apple's own name for the artist. */
  name?: string | null;
  /** The wide picture, cut by Apple to fill the top of their artist page. */
  banner?: string | null;
  /** Width over height of the wide picture. */
  bannerAspect?: number | null;
  /** The hero photograph, as Apple's image service serves it. */
  hero?: string | null;
  /** Width over height of the hero photograph. */
  heroAspect?: number | null;
  /** The square portrait — a tile for lists, never the banner. */
  square?: string | null;
  /** The wide banner, when the artist has one. */
  wide?: string | null;
  /** Width over height of the wide banner. */
  wideAspect?: number | null;
  /** The title logo, a transparent PNG. */
  logo?: string | null;
  /** The logo's width over its height, for sizing without decoding it. */
  logoAspect?: number;
  /** The looping motion clip (HLS). */
  motion?: string | null;
  /** A still from the motion clip, for the poster and for the fallback. */
  preview?: string | null;
  /** A landscape still matching Apple's wide artist motion clip. */
  widePreview?: string | null;
  /** The wide motion clip, when the artist has one. */
  wideMotion?: string | null;
  /** Apple's own background colour for the artwork. */
  background?: string | null;
  /** Apple's own accent colour for the artwork. */
  accent?: string | null;
}

/** A matched Apple Music motion canvas for the current album. */
export interface AppleMotionArt {
  url: string | null;
  aspect: number | null;
  album?: string | null;
  /** Apple's own ~30s music-video preview for the recording, when one exists. */
  mv?: { url: string; aspect: number; title?: string } | null;
  /** Every video for the recording: the official one, then director's cut / alternate versions. */
  mvs?: { url: string; aspect: number; title?: string; label?: string; provider?: string }[];
}

export type SearchFilter = 'all' | 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

/** A search row: the promoted song, a song/video, or an artist/album/playlist. */
export type SearchRow =
  | { kind: 'top'; track: Track }
  | { kind: 'track'; track: Track }
  | { kind: 'browse'; item: Card & { kind: 'artist' | 'album' | 'playlist' }; top?: boolean };

export interface SearchPageResult {
  query: string;
  filter: SearchFilter;
  rows: SearchRow[];
  continuation: string | null;
}
