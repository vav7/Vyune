/**
 * identify.js — Song identity engine.
 *
 * "Even if the title is a bit different, identify the song by its metadata."
 *
 * Cross-references three public catalogs in parallel and fuzzy-scores every
 * candidate against the query:
 *   • iTunes Search API  → canonical title/artist/album + exact duration
 *   • Deezer API         → canonical data + **ISRC** (public, no key)
 *   • lrc.red match      → ISRC + lyrics-ready identity in one shot
 *
 * The resulting identity { isrc, canonical title/artist/album/duration }
 * feeds the lyrics engine so providers match on the *real* release, not on
 * whatever decorated title a YouTube upload happened to use.
 *
 * The judgement is the recording matcher (match.js), not a score of this file's own: the matcher already knows
 * that a title carrying a take marker is a different recording, that a
 * runtime far from the one asked for rules a row out, that a credit naming
 * somebody else makes it a cover, and that two releases with one title are
 * two recordings. Scoring it again here, looser, is what let the wrong
 * recording through — the catalogues are full of same-titled songs by
 * different people, and the loose rule accepted them.
 */

import { TTLCache, AsyncResolver, safeFetch, sleep } from './cache.js';
import { tokenSim, levRatio, normText } from './textsim.js';
import { score as matchScore, albumKey, sharesArtist } from './match.js';

const cache = new AsyncResolver(new TTLCache({ max: 2000, ttl: 7 * 24 * 3600_000 }), {
  ttl: 7 * 24 * 3600_000,
  negativeTtl: 6 * 3600_000,
});

/** directional token coverage: fraction of query tokens found in candidate. */
function covSim(a, b) {
  const ta = normText(a).split(' ').filter((t) => t.length > 1);
  const tb = normText(b).split(' ').filter((t) => t.length > 1);
  if (!ta.length || !tb.length) return 0;
  let hit = 0;
  for (const x of ta) {
    if (tb.some((y) => x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))))) hit++;
  }
  return hit / ta.length;
}

/**
 * How well a candidate matches the query, for the fallback path only.
 *
 * The rule that matters: when the query names an artist and the candidate
 * names a different one, the two are not the same recording unless the
 * runtimes agree to the second. The old rule scored the artist at zero and
 * carried on, which is how a song by one person ended up filed under
 * another person's name — and then played, and then given the wrong lyrics.
 */
function scoreCandidate(q, cand) {
  // hard reject: same-ish title but wildly different recording length
  if (q.duration && cand.duration && Math.abs(q.duration - cand.duration) > 90) return 0;
  const tSim = Math.max(
    tokenSim(q.title, cand.title),
    levRatio(q.title, cand.title),
    // decorated YT titles: candidate "Get Lucky" inside "Get Lucky (feat…)"
    normText(cand.title).includes(normText(q.title).split(' ').slice(0, 3).join(' ')) ? 0.8 : 0,
  );
  const aSim = q.artist
    ? Math.max(covSim(q.artist, cand.artist), tokenSim(q.artist, cand.artist), levRatio(q.artist, cand.artist))
    : 0.6;
  let dFit = 0.5;
  if (q.duration && cand.duration) {
    const d = Math.abs(q.duration - cand.duration);
    // uploads/editions/dev cuts drift ±30s; >90s is a different recording (hard-rejected above)
    dFit = d <= 5 ? 1 : d <= 15 ? 0.8 : d <= 30 ? 0.55 : d <= 45 ? 0.35 : 0.15;
  }
  // when we know the artist, artist agreement outweighs title hooks
  return q.artist
    ? 0.45 * tSim + 0.35 * aSim + 0.2 * dFit
    : 0.45 * tSim + 0.3 * aSim + 0.25 * dFit;
}

/**
 * The query's "artist" is sometimes not an artist at all: a film ("Aashiqui
 * 2"), an album, a label, a channel. When the candidate's own release
 * carries that name, the query was naming the release and the candidate's
 * credit is the real one — so the credit is not held against it.
 */
function releaseCarriesTheName(qArtist, cand) {
  if (!qArtist) return false;
  const wanted = albumKey(qArtist);
  if (!wanted) return false;
  const have = albumKey(cand.album);
  return !!have && have === wanted;
}

/** A match.js candidate for a catalogue row. */
const asCandidate = (c) => ({
  title: c.title,
  artist: c.artist,
  durationSec: c.duration || null,
  album: c.album || null,
  isExplicit: null,
});

/**
 * The matcher's verdict on one candidate, with the credit adjusted for the
 * case above. Null means "not the same recording".
 */
function identityScore(q, cand) {
  const target = {
    title: q.title,
    artist: q.artist && !releaseCarriesTheName(q.artist, cand) ? q.artist : '',
    durationSec: q.duration || null,
    album: q.album || null,
    isExplicit: null,
  };
  return matchScore(asCandidate(cand), target);
}

/** The matcher's points, read as a confidence. */
function scoreToConfidence(points) {
  if (points >= 160) return 0.97; // credit and runtime both agreed
  if (points >= 140) return 0.9; // credit agreed
  if (points >= 115) return 0.75; // runtime agreed, no credit to compare
  if (points >= 100) return 0.6; // the title alone
  return 0.5;
}

async function itunes(q) {
  // two term variants: with artist (precision) and title-only (semantic —
  // iTunes maps lyric hooks / alternate titles to the canonical release)
  const terms = [`${q.artist} ${q.title}`.trim(), q.title];
  const fetches = await Promise.all(
    [...new Set(terms)].map((term) =>
      safeFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=6`, {
        timeout: 4500,
      }),
    ),
  );
  const out = [];
  const seen = new Set();
  for (const r of fetches) {
    if (!r?.ok) continue;
    try {
      const j = await r.json();
      for (const t of j.results || []) {
        if (t.wrapperType !== 'track' || seen.has(t.trackId)) continue;
        seen.add(t.trackId);
        out.push({
          source: 'itunes',
          title: t.trackName || '',
          artist: t.artistName || '',
          album: t.collectionName || '',
          duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : 0,
          isrc: t.isrc10 || null,
        });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

async function deezer(q) {
  // advanced query first, plain fallback
  const adv = encodeURIComponent(`artist:"${q.artist}" track:"${q.title}"`);
  const plain = encodeURIComponent(`${q.artist} ${q.title}`.trim());
  for (const term of [adv, plain]) {
    const r = await safeFetch(`https://api.deezer.com/search?q=${term}&limit=5`, { timeout: 4500 });
    if (!r?.ok) continue;
    try {
      const j = await r.json();
      const out = (j.data || []).map((t) => ({
        source: 'deezer',
        title: t.title_short || t.title || '',
        artist: t.artist?.name || '',
        album: t.album?.title || '',
        duration: t.duration || 0,
        isrc: t.isrc || null,
      }));
      if (out.length) return out;
    } catch {}
  }
  return [];
}

const MB_HEADERS = {
  'User-Agent': 'VYUNE/1.0 (music metadata lookup)',
};

/**
 * MusicBrainz (tested & integrated): recording search → lookup with
 * isrcs+releases+artist-credits. Adds an independent ISRC vote, exact
 * release year and proper credited artists. Respects the 1 req/s policy.
 */
async function musicbrainz(q) {
  if (!q.artist) return [];
  try {
    const dur = q.duration ? Math.round(q.duration * 1000) : 0;
    const durFilter = dur ? ` AND dur:[${dur - 20000} TO ${dur + 20000}]` : '';
    const term = encodeURIComponent(`recording:"${q.title}" AND artist:"${q.artist}"${durFilter}`);
    const sr = await safeFetch(`https://musicbrainz.org/ws/2/recording?query=${term}&fmt=json&limit=5`, {
      headers: MB_HEADERS,
      timeout: 4000,
    });
    if (!sr?.ok) return [];
    const sj = await sr.json();
    const recs = (sj.recordings || []).slice(0, 3);
    if (!recs.length) return [];
    await sleep(1100); // MusicBrainz rate limit: 1 request/second
    for (const rec of recs) {
      const lr = await safeFetch(
        `https://musicbrainz.org/ws/2/recording/${rec.id}?inc=isrcs+releases+artist-credits&fmt=json`,
        { headers: MB_HEADERS, timeout: 4000 },
      );
      if (!lr?.ok) continue;
      const lj = await lr.json();
      const rel = (lj.releases || [])[0];
      const isrc = (lj.isrcs || [])[0] || null;
      if (!isrc && recs.indexOf(rec) < recs.length - 1) {
        await sleep(1100);
        continue; // keep looking for a recording that carries an ISRC
      }
      return [
        {
          source: 'musicbrainz',
          title: lj.title || rec.title || '',
          artist: (lj['artist-credit'] || []).map((a) => a.name).join(', '),
          album: rel?.title || '',
          duration: lj.length ? Math.round(lj.length / 1000) : 0,
          isrc,
          year: rel?.date ? parseInt(rel.date, 10) || null : null,
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * BiniLyrics identify ("names the recording first" step): one
 * request answers with the ISRC, the canonical release metadata and the
 * lyric-sheet URL behind it. Duration-sensitive like lrc.red's match.
 */
async function biniIdentify(q) {
  const params = new URLSearchParams({ track: q.title });
  if (q.artist) params.set('artist', q.artist);
  if (q.album) params.set('album', q.album);
  if (q.duration) params.set('duration', String(Math.round(q.duration)));
  const r = await safeFetch(`https://lyrics-api.binimum.org/?${params}`, { timeout: 4500 });
  if (!r?.ok) return [];
  try {
    const j = await r.json();
    return (j.results || [])
      .slice(0, 3)
      .map((h) => ({
        source: 'binilyrics',
        title: h.track_name || q.title,
        artist: h.artist_name || q.artist || '',
        album: h.album_name || '',
        duration: h.duration ? Math.round(h.duration) : 0,
        isrc: h.isrc || null,
      }));
  } catch {
    return [];
  }
}

async function lrcRedMatch(q) {
  const params = new URLSearchParams({ track: q.title, artist: q.artist });
  if (q.duration) params.set('duration', String(Math.round(q.duration)));
  const r = await safeFetch(`https://lrc.red/match.json?${params}`, { timeout: 4500 });
  if (!r?.ok) return [];
  try {
    const j = await r.json();
    return (j.hits || [])
      .slice(0, 3)
      .map((h) => ({
        source: 'lrcred',
        title: h.title || '',
        artist: h.artist || '',
        album: h.album || '',
        duration: h.duration ? Math.round(h.duration) : 0,
        isrc: h.isrc || null,
      }));
  } catch {
    return [];
  }
}

/** Label/channel names carry no artist signal — score those title-only too. */
const LABELISH =
  /(^|\b)(t-?series|zee music|sony music|saregama|vevo|tips official|yrf|dharma|warner music|universal music|beggars|republic records|records|music company|entertainment|films|audio|jukebox|official)(\b|$)/i;

export function isLabelish(artist = '') {
  return LABELISH.test(artist.trim());
}

/**
 * @param {{title:string, artist?:string, album?:string, duration?:number}} q
 * @returns {Promise<{isrc:string|null, canonical:{title,artist,album,duration}, confidence:number, sources:string[]}|null>}
 */
export function identify(q) {
  if (!q?.title) return Promise.resolve(null);
  const key = `id:${normText(q.title)}|${normText(q.artist || '')}|${Math.round(q.duration || 0)}`;
  return cache.resolve(key, async () => {
    // when the credited "artist" is just a label/channel, run a parallel
    // title-only pass so the real artist can be recovered from catalogs
    const altQ = isLabelish(q.artist || '') ? { ...q, artist: '' } : null;
    const [it, dz, lr, bn, it2, dz2, lr2, bn2] = await Promise.all([
      itunes(q), deezer(q), lrcRedMatch(q), biniIdentify(q),
      altQ ? itunes(altQ) : Promise.resolve([]),
      altQ ? deezer(altQ) : Promise.resolve([]),
      altQ ? lrcRedMatch(altQ) : Promise.resolve([]),
      altQ ? biniIdentify(altQ) : Promise.resolve([]),
    ]);
    const all = [...it, ...dz, ...lr, ...bn, ...it2, ...dz2, ...lr2, ...bn2];

    // MusicBrainz has a 1.1s rate-limit delay; ask it only when fast primary catalogs found nothing
    if (!all.length) {
      all.push(...(await musicbrainz(q)));
    }
    if (!all.length) return null;

    // The matcher's verdict, candidate by candidate. It is the same judgement
    // the stream resolver and the catalogue use, so the identity it names is
    // the identity that will actually be played.
    const judged = all
      .map((c) => ({ c, points: identityScore(q, c) }))
      .filter((x) => x.points != null)
      .sort((a, b) => b.points - a.points);

    let best = null;
    let confidence = 0;
    if (judged.length) {
      best = judged[0].c;
      confidence = scoreToConfidence(judged[0].points);
    }

    // The matcher refused everything. Fall back to the old fuzzy reading,
    // but only where it is safe: the credit has to agree, or the runtimes
    // have to agree to the second. A same-titled song by somebody else is
    // not this song, however close the spelling.
    if (!best) {
      const fuzzy = all
        .map((c) => ({ c, s: scoreCandidate(q, c) }))
        .filter((x) => x.s >= 0.72)
        .sort((a, b) => b.s - a.s);
      const pick = fuzzy.find(
        (x) =>
          !q.artist ||
          isLabelish(q.artist) ||
          sharesArtist(q.artist, x.c.artist),
      );
      if (pick) {
        best = pick.c;
        confidence = 0.68;
      }
    }

    if (!best) return null; // not confident — don't poison matching
    if (process.env.LYRICS_DEBUG) {
      console.error(`[identify] best=${best.title} | ${best.artist} | conf=${confidence}`);
    }

    // ISRC: prefer one two independent sources agree on; else the best scorer's
    const counts = new Map();
    for (const c of all) {
      if (!c.isrc) continue;
      const points = identityScore(q, c);
      if (points != null && points >= 115) counts.set(c.isrc, (counts.get(c.isrc) || 0) + 1);
    }
    const agreed = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const isrc =
      (agreed && agreed[1] >= 2 ? agreed[0] : null) ||
      best.isrc ||
      [...all]
        .sort((a, b) => (identityScore(q, b) ?? -1) - (identityScore(q, a) ?? -1))
        .find((c) => c.isrc && identityScore(q, c) != null)?.isrc ||
      null;

    return {
      isrc,
      canonical: {
        title: best.title,
        artist: best.artist,
        album: best.album || q.album || '',
        duration: best.duration || q.duration || 0,
      },
      confidence: Math.round(confidence * 100) / 100,
      sources: [...new Set(all.filter((c) => identityScore(q, c) != null).map((c) => c.source))],
    };
  });
}
