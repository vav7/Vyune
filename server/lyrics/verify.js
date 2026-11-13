/**
 * verify.js — is this candidate the recording that is playing?
 *
 * Catalogues are full of songs that share a title, and a sheet filed under one
 * of them is a cover's or a re-upload's, whose words are somebody else's. A
 * miss is recoverable (the next provider gets its turn); the wrong words
 * scrolling in time with the right song is not. So every test is a
 * requirement, not a score.
 */

import { score as matchScore, sharesArtist } from '../match.js';
import { normKey, VERSION_WORDS } from './text.js';

/**
 * The recording matcher's judgement, plus one rule for lyrics: the credit has to agree too.
 * A same-title cover can share a runtime to the second, so duration alone never validates a sheet.
 */
export function isThisSong(candidate, { title, artist, duration, album }) {
  const target = {
    title: title || '',
    artist: artist || '',
    durationSec: duration > 0 ? duration : null,
    album: album || null,
    isExplicit: null,
  };
  const cand = { isExplicit: null, album: null, ...candidate };
  if (matchScore(cand, target) == null) return false;
  if (artist && cand.artist && !sharesArtist(artist, cand.artist)) return false;
  return true;
}

/* ---- the strict matcher for free-text search hits ---- */

const BRACKETED = /[(\[][^)\]]*[)\]]/g;
const coreOf = (title) => normKey(title.replace(BRACKETED, ' ').split(' - ')[0]) || normKey(title);
const versionOf = (title) => {
  const extras = `${(title.match(BRACKETED) || []).join(' ')} ${title.split(' - ').slice(1).join(' ')}`;
  return new Set(normKey(extras).split(' ').filter((w) => VERSION_WORDS.has(w)));
};
const artistsOf = (artist) =>
  new Set(String(artist).split(/\s*(?:,|&|;|\/|\s+and\s+|\s+x\s+|\s+with\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i).map(normKey).filter(Boolean));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The hit that is this recording, or null if none of them surely is:
 *  - the title, outside its brackets and any " - " suffix, is the same;
 *  - the version words (live, remix, acoustic…) are the same on both sides;
 *  - at least one credited artist is shared;
 *  - the length is within `tolerance` seconds, when both are known.
 * Of the hits that pass, the closest in length wins; the search's own rank breaks a tie.
 */
export function bestHit(hits, { title, artist, duration }, { tolerance = 3, accept = () => true } = {}) {
  const wantedTitle = coreOf(title);
  const wantedVersion = versionOf(title);
  const wantedArtists = artistsOf(artist);
  const distance = (h) => (duration > 0 && h.duration != null ? Math.abs(h.duration - duration) : 0);
  return (
    hits
      .filter((h) => {
        const name = h.title || h.trackName || h.track_name;
        if (!name || !accept(h)) return false;
        const hitArtists = artistsOf(h.artist || h.artistName || h.artist_name || '');
        return (
          coreOf(name) === wantedTitle &&
          sameSet(versionOf(name), wantedVersion) &&
          (!wantedArtists.size || [...hitArtists].some((a) => wantedArtists.has(a))) &&
          distance(h) <= tolerance
        );
      })
      .sort((a, b) => distance(a) - distance(b))[0] || null
  );
}
