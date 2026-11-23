/**
 * verify.js — is this candidate the recording that is playing?
 *
 * Catalogues are full of songs that share a title, and a sheet filed under one
 * of them is a cover's or a re-upload's, whose words are somebody else's. A
 * miss is recoverable (the next provider gets its turn); the wrong words
 * scrolling in time with the right song is not. So every test is a
 * requirement, not a score.
 */

import { score as matchScore, sharesArtist, albumKey, areSequelClash } from '../match.js';
import { cleanTitle, normKey, VERSION_WORDS } from './text.js';

function extractPartNum(str) {
  if (!str) return null;
  const s = String(str).toLowerCase();
  const m = s.match(/\b(?:part|pt|chapter|vol|volume)?\s*([0-9]+|[ivx]+)\b/i);
  if (!m) return null;
  const val = m[1].toLowerCase();
  if (val === 'i' || val === '1') return 1;
  if (val === 'ii' || val === '2') return 2;
  if (val === 'iii' || val === '3') return 3;
  if (val === 'iv' || val === '4') return 4;
  if (val === 'v' || val === '5') return 5;
  const num = parseInt(val, 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * The recording matcher's judgement, plus strict rules for lyrics:
 *  - Credit must agree when artist is known;
 *  - Core song title must agree (never a substring of a completely different track);
 *  - Sequels / Part 1 vs Part 2 / album clash must not match the wrong movie or take.
 */
export function isThisSong(candidate, { title, artist, duration, album }) {
  if (!candidate || !title) return false;

  const target = {
    title: title || '',
    artist: artist || '',
    durationSec: duration > 0 ? duration : null,
    album: album || null,
    isExplicit: null,
  };
  const cand = { isExplicit: null, album: null, ...candidate };

  // 1. Core title check: candidate must share the core title
  const targetCore = coreOf(title);
  const candCore = coreOf(cand.title || '');
  if (!targetCore || !candCore) return false;

  // Title must match or have strong core similarity
  const cleanT = normKey(cleanTitle(title, artist));
  const cleanC = normKey(cleanTitle(cand.title || '', cand.artist || ''));
  const titleMatches =
    targetCore === candCore ||
    cleanT === cleanC ||
    (targetCore.length >= 5 && candCore.length >= 5 && (targetCore === candCore || targetCore.replace(/\s+/g, '') === candCore.replace(/\s+/g, '')));
  
  if (!titleMatches && matchScore(cand, target) == null) {
    return false;
  }

  // 2. Duration check: if both durations are known, they must not severely disagree
  if (target.durationSec && cand.durationSec) {
    const diff = Math.abs(target.durationSec - cand.durationSec);
    const maxDiff = Math.max(8, Math.min(18, target.durationSec * 0.08));
    if (diff > maxDiff) {
      return false;
    }
  }

  // 3. Artist verification
  if (artist && cand.artist) {
    if (!sharesArtist(artist, cand.artist)) return false;
  } else if (artist && !cand.artist) {
    // If target artist is known, candidate without artist MUST match title tightly
    if (targetCore !== candCore && cleanT !== cleanC) return false;
    // And if duration is known on both, must be within 6s
    if (target.durationSec && cand.durationSec && Math.abs(target.durationSec - cand.durationSec) > 6) {
      return false;
    }
  }

  // 4. Sequel / Part Disambiguation (e.g. Awarapan 1 vs Awarapan 2, Hate Story 4 vs 2005 original)
  if (areSequelClash(album, cand.album) || areSequelClash(title, cand.title)) {
    return false;
  }
  const targetPart = extractPartNum(title) || extractPartNum(album);
  const candPart = extractPartNum(cand.title) || extractPartNum(cand.album);
  if (targetPart != null && candPart != null && targetPart !== candPart) {
    return false;
  }
  if (targetPart != null && targetPart > 1 && candPart === 1) {
    return false;
  }

  // 5. Album Disambiguation (if albums exist on both and distinctly conflict)
  if (album && cand.album) {
    const ak1 = albumKey(album);
    const ak2 = albumKey(cand.album);
    if (ak1 && ak2 && ak1 !== ak2) {
      // If albums are completely different movie franchises/titles and duration differs by > 10s, reject
      if (target.durationSec && cand.durationSec && Math.abs(target.durationSec - cand.durationSec) > 10) {
        return false;
      }
    }
  }

  // 6. Version marker check: versions must not disagree
  const v1 = versionOf(title);
  const v2 = versionOf(cand.title || '');
  if (!sameSet(v1, v2)) {
    return false;
  }

  return true;
}

/* ---- the strict matcher for free-text search hits ---- */

const BRACKETED = /[(\[][^)\]]*[)\]]/g;
export const coreOf = (title) => {
  const stripped = String(title || '').replace(BRACKETED, ' ').trim();
  const parts = stripped.split(/\s*[-–—]\s*/);
  if (parts.length > 1) {
    const p1 = normKey(parts[0]);
    if (p1 && p1.length >= 2) return p1;
  }
  return normKey(stripped) || normKey(title);
};
export const versionOf = (title) => {
  const extras = `${(title.match(BRACKETED) || []).join(' ')} ${title.split(/\s*[-–—]\s*/).slice(1).join(' ')} ${title}`;
  return new Set(normKey(extras).split(' ').filter((w) => VERSION_WORDS.has(w)));
};
export const artistsOf = (artist) =>
  new Set(String(artist).split(/\s*(?:,|&|;|\/|\s+and\s+|\s+x\s+|\s+with\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i).map(normKey).filter(Boolean));
export const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The hit that is this recording, or null if none of them surely is:
 *  - the title, outside its brackets and any " - " suffix, is the same;
 *  - the version words (live, remix, acoustic…) are the same on both sides;
 *  - at least one credited artist is shared;
 *  - the length is within `tolerance` seconds, when both are known.
 * Of the hits that pass, the closest in length wins; the search's own rank breaks a tie.
 */
export function bestHit(hits, { title, artist, duration }, { tolerance = 4, accept = () => true } = {}) {
  const wantedTitle = coreOf(title);
  const wantedVersion = versionOf(title);
  const wantedArtists = artistsOf(artist);
  const reqClean = normKey(cleanTitle(title, artist));
  const distance = (h) => (duration > 0 && h.duration != null ? Math.abs(h.duration - duration) : 0);
  return (
    hits
      .filter((h) => {
        const name = h.title || h.trackName || h.track_name;
        if (!name || !accept(h)) return false;
        const candTitle = coreOf(name);
        const candClean = normKey(cleanTitle(name));
        const titleMatch = candTitle === wantedTitle || candClean === reqClean || candClean === wantedTitle || candTitle === reqClean;
        const hitArtists = artistsOf(h.artist || h.artistName || h.artist_name || '');
        const artistMatch = !wantedArtists.size || [...hitArtists].some((a) => [...wantedArtists].some((wa) => wa === a || wa.includes(a) || a.includes(wa)));
        return (
          titleMatch &&
          sameSet(versionOf(name), wantedVersion) &&
          artistMatch &&
          distance(h) <= tolerance
        );
      })
      .sort((a, b) => distance(a) - distance(b))[0] || null
  );
}
