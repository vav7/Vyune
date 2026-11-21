/**
 * engine.js — one lookup, start to finish.
 *
 *   1. CLEAN     the player's title/artist become what databases filed (text.js).
 *   2. IDENTIFY  BiniLyrics names the recording (its ISRC) in <=1.8 s, remembered per song, so providers
 *                that can ask by recording do, and cannot return the wrong edit.
 *   3. RACE      every provider starts at once, each with its own 7.5 s budget.
 *   4. PICK      progressively, not in arrival order and not waiting for the slowest:
 *                  word-synced  wins once every better-placed provider has answered, or after 0.7 s;
 *                  line-synced  is answered after 0.9 s, and the hunt for word timing CONTINUES;
 *                  words only   is the floor.
 *   5. UPGRADE   the answer goes out at once (`upgrading: true`); a background hunt writes any better
 *                sheet into the cache under the same key and the client picks it up by polling.
 *   6. REPAIR    nothing found? ask the identity engine for canonical names and re-ask the families that
 *                carry timing; still nothing? words with an estimated timing, labelled, briefly cached.
 *
 * Never "not available" while anyone has the words; never an endless loop: every wait has a budget.
 */

import { AsyncResolver, TTLCache, withTimeout } from '../cache.js';
import * as yt from '../yt.js';
import { identify as identifyCanonical, isLabelish } from '../identify.js';
import { sharesArtist } from '../match.js';
import { createIo } from './io.js';
import { hasLineSync, hasWordSync, providerId, sheetScore, tierOf } from './model.js';
import { present } from './shape.js';
import { artistVariants, cleanArtist, cleanTitle, normKey } from './text.js';
import { identify as identifyRecording } from './providers/bini.js';
import { plainFallback } from './providers/plain.js';
import { PROVIDERS, providerFor } from './providers/index.js';

/* ---------------------------- budgets ---------------------------- */

export const BUDGET = {
  total: 8_500, // the first answer, identification included
  response: 11_000, // the route's hard ceiling
  source: 7_500, // each provider's own
  isrc: 2_000, // how long identification may hold the recording-aware providers back
  wordGrace: 700, // a word sheet in hand: how long a better-placed provider may still beat it
  lineGrace: 2_200, // a line sheet in hand: give word timing up to 2.2s before settling for line timing
};

const DAY = 24 * 3600_000;
const PLAIN_TTL = 75_000;

/* ---------------------------- caches ---------------------------- */

/** Every provider's sheet for a song, from the main run, so choosing a provider the menu LISTS is a lookup. */
export const book = new TTLCache({ max: 300, ttl: 7 * DAY });
const BOOK_PER_SONG = 5;

export const answers = new AsyncResolver(new TTLCache({ max: 400, ttl: 7 * DAY }), {
  ttl: 7 * DAY,
  staleFor: 30 * DAY,
  // A miss is remembered only briefly: providers are flaky, and a long sentence on "no lyrics" outlived the outage that caused it.
  negativeTtl: 30_000,
});

const answerTtl = (a) => (a?.upgrading ? 12_000 : a?.primary?.estimated ? 10 * 60_000 : a?.primary && !a.primary.isSynced ? PLAIN_TTL : undefined);

/** Recordings already identified: "title|artist|duration/3" → { isrc, hit }. Small LRU, memory only. */
const recordings = new Map();
const RECORDINGS_MAX = 500;

/* ---------------------------- context ---------------------------- */

const songKey = (p) => `${normKey(cleanTitle(p.title || '') || p.title || '')}|${normKey(p.artist || '')}|${Math.round(p.duration || 0)}`;

/** Title/artist as providers want them; an artist-less upload recovers its artist from the search that found it. */
export function contextFrom(params) {
  const title = cleanTitle(params.title || '') || params.title || '';
  let artist = cleanArtist(params.artist || '');
  if (!artist && params.q) {
    const known = new Set(normKey(title).split(' '));
    const rest = normKey(params.q).split(' ').filter((t) => t.length > 1 && !known.has(t)).join(' ');
    if (rest.length >= 3) artist = rest;
  }
  return {
    title,
    artist,
    album: params.album || undefined,
    duration: params.duration || undefined,
    isrc: params.isrc || undefined,
    videoId: params.videoId || undefined,
    channel: params.channel || undefined,
  };
}

/** The watch-page record behind a YouTube video is the credit the words are filed under. */
function withWatchMeta(base, meta) {
  if (!meta?.title) return base;
  const metaArtist = (meta.artists || []).join(', ');
  return {
    ...base,
    title: cleanTitle(meta.title) || base.title,
    artist: base.artist && !isLabelish(base.artist) && sharesArtist(base.artist, metaArtist) ? base.artist : metaArtist || base.artist,
    album: base.album || meta.album || undefined,
    duration: base.duration || meta.duration || undefined,
  };
}

const weak = (ctx) => !ctx.artist || isLabelish(ctx.artist) || !ctx.album;

/* ---------------------------- running a provider ---------------------------- */

const usable = (sheet) =>
  !!sheet?.lines?.length && !sheet.estimated && (hasWordSync(sheet) || hasLineSync(sheet));

async function runProvider(provider, ctx, io, env, ms = BUDGET.source) {
  try {
    const sheet = await withTimeout(Promise.resolve().then(() => provider.run(ctx, io, env)), ms, null);
    if (!sheet?.lines?.length) return null;
    return { ...sheet, source: provider.label, providerId: provider.id };
  } catch {
    return null;
  }
}

/** Who is this recording? Asked of BiniLyrics, remembered. */
async function recordingOf(ctx, io, ms) {
  if (ctx.isrc) return { isrc: ctx.isrc, hit: null };
  const key = `${normKey(ctx.title)}|${normKey(ctx.artist)}|${Math.round((ctx.duration || 0) / 3)}`;
  const known = recordings.get(key);
  if (known) {
    recordings.delete(key);
    recordings.set(key, known); // most recently used
    return known;
  }
  if (ms <= 0) return { isrc: null, hit: null };
  const hit = await withTimeout(identifyRecording(ctx, io).catch(() => null), ms, null);
  const found = { isrc: hit?.isrc || null, hit };
  if (hit) {
    recordings.set(key, found);
    if (recordings.size > RECORDINGS_MAX) recordings.delete(recordings.keys().next().value);
  }
  return found;
}

/* ---------------------------- the race ---------------------------- */

/**
 * Every provider running at once. `entries[i]` is provider i (i = priority). A settled entry holds its
 * usable sheet or null. `wait()` resolves on the next settle, so a picker can be woken by any answer
 * without polling.
 */
class Race {
  constructor(providers, start) {
    this.entries = providers.map((provider, i) => ({ provider, i, sheet: null, settled: false }));
    this.waiters = [];
    for (const entry of this.entries) {
      start(entry.provider).then((sheet) => {
        entry.sheet = usable(sheet) ? sheet : null;
        entry.settled = true;
        const wake = this.waiters.splice(0);
        for (const resolve of wake) resolve();
      });
    }
  }

  wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.max(1, ms));
      this.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  get allSettled() {
    return this.entries.every((e) => e.settled);
  }

  /** The best-scoring settled sheet that satisfies `tier` (a predicate over sheets). */
  best(tier) {
    return this.entries.filter((e) => e.sheet && tier(e.sheet)).sort((a, b) => sheetScore(b.sheet) - sheetScore(a.sheet))[0] || null;
  }

  /** Every sheet heard so far, best first. */
  heard() {
    return this.entries.filter((e) => e.sheet).map((e) => e.sheet).sort((a, b) => sheetScore(b) - sheetScore(a));
  }

  /** Is any provider ranked above `entry` still out? */
  betterPending(entry) {
    return this.entries.some((e) => !e.settled && e.i < entry.i);
  }

  /**
   * Wait for the first answer worth giving:
   *   → { sheet }               a word-synced sheet (wins once nobody better-placed is pending, or after the grace)
   *   → { sheet, upgrade: true } a line-synced sheet, after its grace: the hunt for word timing goes on
   *   → { sheet: null }          nothing usable before the deadline
   */
  async pick(deadline) {
    let wordAt = 0;
    let lineAt = 0;
    for (;;) {
      const now = Date.now();
      const word = this.best(hasWordSync);
      if (word) {
        wordAt ||= now;
        if (!this.betterPending(word) || now - wordAt >= BUDGET.wordGrace) return { sheet: word.sheet };
      } else {
        const line = this.best(hasLineSync);
        if (line) {
          lineAt ||= now;
          if (now - lineAt >= BUDGET.lineGrace) return { sheet: line.sheet, upgrade: true };
        }
      }
      if (this.allSettled || now >= deadline) return { sheet: this.heard()[0] || null, upgrade: !!this.heard()[0] };
      await this.wait(Math.min(deadline, wordAt ? wordAt + BUDGET.wordGrace : Infinity, lineAt ? lineAt + BUDGET.lineGrace : Infinity) - now);
    }
  }

  /** The upgrade hunt: the first word-synced sheet, by the same rule, within `ms`. */
  async untilWord(ms) {
    const stop = Date.now() + ms;
    let seen = 0;
    for (;;) {
      const word = this.best(hasWordSync);
      const now = Date.now();
      if (word) {
        seen ||= now;
        if (!this.betterPending(word) || now - seen >= BUDGET.wordGrace) return word.sheet;
      }
      if (this.allSettled || now >= stop) return null;
      await this.wait(Math.min(stop, seen ? seen + BUDGET.wordGrace : Infinity, now + 150) - now);
    }
  }
}

/* ---------------------------- answers ---------------------------- */

function remember(bk, sheets) {
  const entry = book.get(bk) || {};
  for (const sheet of sheets) if (sheet && usable(sheet)) entry[sheet.providerId || providerId(sheet.source)] ??= sheet;
  const keep = Object.entries(entry).sort(([, a], [, b]) => sheetScore(b) - sheetScore(a)).slice(0, BOOK_PER_SONG);
  book.set(bk, Object.fromEntries(keep));
}

/** The other sheets kept for the song, so choosing one never makes the rest vanish from the menu. */
function alternatesOf(bk, exceptSource) {
  const skip = String(exceptSource || '');
  return Object.values(book.get(bk) || {})
    .filter((s) => s.source !== skip)
    .sort((a, b) => sheetScore(b) - sheetScore(a))
    .map((s) => ({ source: s.source, tier: tierOf(s) === 'word' ? 'word' : 'line' }));
}

function answerFor(bk, winner, pool, upgrading) {
  remember(bk, [winner, ...pool]);
  const allHeard = Object.values(book.get(bk) || {});
  const combined = [...pool, ...allHeard];
  const listed = new Set([winner.source]);
  const alternates = [];
  for (const sheet of combined) {
    if (!sheet || listed.has(sheet.source)) continue;
    listed.add(sheet.source);
    const tier = tierOf(sheet);
    alternates.push({ source: sheet.source, tier: tier === 'estimated' ? 'plain' : tier });
  }
  const out = { status: 'ok', primary: present(winner), alternates: alternates.slice(0, 8) };
  if (upgrading) out.upgrading = true;
  return out;
}

/* ---------------------------- repair ---------------------------- */

/** Ask the identity engine for the canonical names, then re-ask the families that carry timing. */
async function secondChance(ctx, io, env) {
  const identity = await withTimeout(identifyCanonical(ctx).catch(() => null), 2_500, null);
  if (!identity?.canonical && !identity?.isrc) return [];
  const better = {
    ...ctx,
    title: identity.canonical?.title ? cleanTitle(identity.canonical.title) || ctx.title : ctx.title,
    artist: identity.canonical?.artist && (!ctx.artist || isLabelish(ctx.artist)) ? identity.canonical.artist : ctx.artist,
    duration: ctx.duration || identity.canonical?.duration,
    isrc: ctx.isrc || identity.isrc || undefined,
  };
  const families = ['amll', 'betterlyrics-ttml', 'betterlyrics-qq', 'lrc.red', 'netease', 'kugou', 'betterlyrics-kugou', 'lrclib'];
  const retry = await Promise.all(PROVIDERS.filter((p) => families.includes(p.id)).map((p) => runProvider(p, better, io, env)));
  return retry.filter(usable);
}

/* ---------------------------- a named provider ---------------------------- */

/** The UI's source switcher: one provider, with the raw names and then the canonical ones, so it never says "not found" because an upload's metadata was dirty. */
async function forced(name, params, ctx, bk, started, io, watchMetaP) {
  const provider = providerFor(name);
  if (!provider) return null;
  const kept = book.get(bk)?.[provider.id];
  if (kept) return { status: 'ok', primary: present(kept), alternates: alternatesOf(bk, kept.source) };

  const left = () => Math.max(0, started + BUDGET.total - Date.now());
  const env = { recording: await recordingOf(ctx, io, Math.min(BUDGET.isrc, left())) };
  const identityP = ctx.isrc ? Promise.resolve(null) : identifyCanonical(ctx).catch(() => null);
  const attempt = (c, ms) => runProvider(provider, c, io, env, ms);

  const canonicalP = identityP.then(async (identity) => {
    if (!identity?.canonical && !identity?.isrc) return null;
    const title = identity.canonical ? cleanTitle(identity.canonical.title) || ctx.title : ctx.title;
    const base = ctx.artist && !isLabelish(ctx.artist) ? ctx.artist : identity.canonical?.artist || ctx.artist;
    const found = await Promise.all(
      artistVariants(base).map((artist) => attempt({ ...ctx, title, artist, duration: identity.canonical?.duration || ctx.duration, isrc: ctx.isrc || identity.isrc || undefined }, 4500)),
    );
    return found.find((s) => s?.lines?.length) || null;
  });
  const first = (settled) => settled.find((s) => s.status === 'fulfilled' && s.value?.lines?.length)?.value ?? null;

  let settled = await withTimeout(Promise.allSettled([attempt(ctx, 5000), canonicalP]), left(), []);
  let sheet = first(settled);
  if (!sheet) {
    const meta = await watchMetaP;
    if (meta && left() > 0) {
      settled = await withTimeout(Promise.allSettled([attempt(withWatchMeta(ctx, meta), 3500), canonicalP]), left(), []);
      sheet = first(settled);
    }
  }
  if (!sheet || !usable(sheet)) return null;
  remember(bk, [sheet]);
  return { status: 'ok', primary: present(sheet), alternates: alternatesOf(bk, sheet.source) };
}

/* ---------------------------- the lookup ---------------------------- */

async function lookup(params, forceSource, cacheKey) {
  const started = Date.now();
  const deadline = started + BUDGET.total;
  const left = () => Math.max(0, deadline - Date.now());
  const io = createIo();
  let ctx = contextFrom(params);
  const bk = songKey(params);

  // The video's own watch record, in the background: applied only when the upload's identity is weak.
  const watchMetaP = ctx.videoId && weak(ctx) ? withTimeout(yt.getTrackWatchMeta(ctx.videoId), 2500, null) : Promise.resolve(null);

  if (forceSource) return forced(forceSource, params, ctx, bk, started, io, watchMetaP);

  if (weak(ctx)) ctx = withWatchMeta(ctx, await withTimeout(watchMetaP, Math.min(1_200, left()), null));

  // 1. Identify canonical metadata concurrently from the start (iTunes / Deezer ISRC)
  const identityP = ctx.isrc
    ? Promise.resolve({ isrc: ctx.isrc, canonical: null })
    : withTimeout(identifyCanonical(ctx).catch(() => null), Math.min(BUDGET.isrc, left()), null);

  // 2. Identification runs alongside the providers instead of in front of them
  const recordingP = recordingOf(ctx, io, Math.min(BUDGET.isrc, left()));
  const race = new Race(PROVIDERS, async (provider) => {
    let providerCtx = ctx;
    let env = {};
    if (provider.needsRecording || ['amll', 'betterlyrics-ttml', 'betterlyrics-qq', 'netease', 'kugou', 'lrc.red'].includes(provider.id)) {
      const [recording, identity] = await Promise.all([
        withTimeout(recordingP, 700, { isrc: null, hit: null }),
        withTimeout(identityP, 700, null),
      ]);
      env = { recording };
      if (identity?.canonical) {
        providerCtx = {
          ...ctx,
          title: cleanTitle(identity.canonical.title) || ctx.title,
          artist: ctx.artist && !isLabelish(ctx.artist) ? ctx.artist : (identity.canonical.artist || ctx.artist),
          album: ctx.album || identity.canonical.album || undefined,
          duration: ctx.duration || identity.canonical.duration || undefined,
          isrc: ctx.isrc || identity.isrc || undefined,
        };
      }
    }
    return runProvider(provider, providerCtx, io, env);
  });
  const env = { recording: await withTimeout(recordingP, 50, { isrc: null, hit: null }) };

  const { sheet: first, upgrade } = await race.pick(deadline);

  if (!first) {
    // Nothing from the first pass: canonical names are the best hope, then the words-only fallback.
    let winner = null;
    for (const sheet of await secondChance(ctx, io, env)) if (!winner || sheetScore(sheet) > sheetScore(winner)) winner = sheet;
    winner ||= await withTimeout(plainFallback(ctx, io).catch(() => null), 4_000, null);
    return winner ? answerFor(bk, winner, [winner, ...race.heard()], false) : null;
  }
  if (!upgrade) return answerFor(bk, first, race.heard(), false);

  // The answer is out; the hunt goes on. Whatever word-synced sheet turns up is written into the cache
  // under the same key, and the client — which polls while `upgrading` is true — swaps it in.
  void (async () => {
    try {
      const identity = await identityP;
      const canonicalCtx = identity?.canonical ? {
        ...ctx,
        title: cleanTitle(identity.canonical.title) || ctx.title,
        artist: ctx.artist && !isLabelish(ctx.artist) ? ctx.artist : (identity.canonical.artist || ctx.artist),
        album: ctx.album || identity.canonical.album || undefined,
        duration: ctx.duration || identity.canonical.duration || undefined,
        isrc: ctx.isrc || identity.isrc || undefined,
      } : ctx;

      let best = await race.untilWord(BUDGET.source);
      const pool = race.heard();
      if (!best || !hasWordSync(best)) {
        for (const sheet of await secondChance(canonicalCtx, io, env)) {
          pool.push(sheet);
          if (hasWordSync(sheet) && (!best || sheetScore(sheet) > sheetScore(best))) best = sheet;
        }
      }
      const final = best || first;
      answers.cache.set(cacheKey, answerFor(bk, final, [first, ...pool], false), tierOf(final) === 'plain' ? PLAIN_TTL : DAY);
    } catch {
      answers.cache.set(cacheKey, answerFor(bk, first, [first, ...race.heard()], false), tierOf(first) === 'plain' ? PLAIN_TTL : DAY);
    }
  })();
  return answerFor(bk, first, race.heard(), true);
}

/**
 * Main entry.
 *   { status:'ok', primary:{source,lines,isWordSynced,isSynced,songwriters,isrc,estimated,meta}, alternates:[{source,tier}], upgrading? }
 *   null when nothing was found (the resolver negative-caches that for 30 s)
 */
export function fetchLyrics(params, { refresh = false, forceSource = null } = {}) {
  const key = `ly:${normKey(cleanTitle(params.title || '') || params.title)}|${normKey(params.artist)}|${normKey(params.q || '')}|${Math.round(params.duration || 0)}|${forceSource || ''}`;
  if (refresh) answers.cache.delete(key);
  return answers.resolve(key, () => lookup(params, forceSource, key), answerTtl);
}
