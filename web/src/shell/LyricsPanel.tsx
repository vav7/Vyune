/* LyricsPanel.tsx — the side panel's (and full-screen player's) lyrics.
 *
 * Our server's engine decides the lyrics (10 providers, identity-matched,
 * word-sync > line-sync, never unsynced). The rendering is the am-lyrics
 * web component (AmLyricsView.tsx).
 * The clock is the steered LyricClock: readings dated by sample time, jumps
 * announced, nothing but an announced jump moves words backwards.
 */

import { ensureIndicFonts } from '@/lib/fonts';
import { LyricClock } from '@/lib/clock';
import { Check, ChevronDown, Languages, RotateCw, Type } from 'lucide-solid';
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import type { LyricsLine, LyricsResult } from '@/lib/types';
import { audio, playerStore } from '@/store/player';
import { lyricsStore, type LyricsPick } from '@/store/lyrics';
// am-lyrics is loaded on first use: it stays out of the initial bundle.
const AmLyricsView = lazy(() => import('./AmLyricsView').then((m) => ({ default: m.AmLyricsView })));

/** The stable "nothing picked" answer. A fresh object every render would
 *  re-render the panel for ever. */
const NO_PICK: LyricsPick = { source: null, retry: 0, forceRefresh: false, upgradeAttempt: 0 };

function LoadingDots(props: { small?: boolean }) {
  return (
    <span class={`lyric-loading-dots${props.small ? ' lyric-loading-dots-small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * The lyric typeface (Inter Variable, @font-face in index.css), then the Indic faces.
 *
 * The faces that follow it are the ones that carry the scripts the phone's
 * face does not: Inter is cut to Latin by its unicode-range, so Devanagari,
 * Arabic and Thai fall through to the next family in the list. Keep platform Indic fonts before the generic fallback,
 * so a missing bundled family does not split lyrics into inconsistent faces.
 */
const LYRIC_FONT =
  "'MC SF Pro Display', 'SF Pro Rounded', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter Variable', 'Inter', 'Helvetica Neue', " +
  "'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Gurmukhi', " +
  "'Noto Sans Gujarati', 'Noto Sans Oriya', 'Noto Sans Tamil', 'Noto Sans Telugu', " +
  "'Noto Sans Kannada', 'Noto Sans Malayalam', 'Nirmala UI', 'Mangal', 'Kohinoor Devanagari', " +
  "'Devanagari Sangam MN', 'Noto Sans Arabic', 'Noto Sans Thai', " +
  "system-ui, sans-serif";

let lyricFont: Promise<void> | null = null;
let lyricFontLoaded = false;

/**
 * Both weights, fetched once. The renderer measures its lines for the scroll
 * and the paint, so it's only built once the face is in; a slow network gives
 * up after 1.5 s and lets the fallback show.
 */
function loadLyricFont(): Promise<void> {
  ensureIndicFonts();
  lyricFont ??= Promise.race([
    Promise.all([document.fonts.load(`700 28px ${LYRIC_FONT}`), document.fonts.load(`400 28px ${LYRIC_FONT}`)]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ])
    .catch(() => undefined)
    .then(() => {
      lyricFontLoaded = true;
    });
  return lyricFont;
}

/** Whether the lyric face is ready. Returns the accessor — call it. */
function useLyricFont(): () => boolean {
  const [ready, setReady] = createSignal(lyricFontLoaded);
  createEffect(() => {
    if (!ready()) void loadLyricFont().then(() => setReady(true));
  });
  return ready;
}



const ALL_KNOWN_PROVIDERS = [
  'LyricsPlus',
  'LRC.RED',
  'BetterLyrics',
  'SimpMusic',
  'LRCLIB',
  'Unison',
  'BetterLyrics (QQ)',
  'YouTube Music',
  'BiniLyrics',
  'NetEase',
  'KuGou',
  'AMLL',
];

/** Which sheet is showing, and the alternates the engine found for it. */
function ProviderPicker(props: {
  result: LyricsResult | null;
  picked: string | null;
  onPick: (source: string | null) => void;
  onFindBest: () => void;
  loading: boolean;
  full: boolean;
  romanization: boolean;
  translation: boolean;
  onRomanization: () => void;
  onTranslation: () => void;
}) {
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  const label = createMemo(() => {
    const picked = props.picked;
    if (picked) {
      return picked;
    }
    return props.result?.primary?.source ?? 'Lyrics';
  });
  // Who is serving these words: the provider the listener chose, or the one
  // the engine settled on. It is ticked in the header as soon as it is known,
  // so the answer is readable without opening the menu.
  const serving = createMemo(() => props.picked || props.result?.primary?.source || null);
  const alternates = createMemo(() => props.result?.alternates ?? []);
  const close = () => setAnchor(null);
  return (
    <div
      class={
        props.full
          ? 'flex items-center justify-between pb-1 opacity-100 transition-opacity duration-500 group-data-[idle=true]:pointer-events-none group-data-[idle=true]:opacity-0'
          : 'flex items-center justify-between px-4 pt-4 pb-1'
      }
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <button
          class="inline-flex min-w-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 type-callout-emphasized text-secondary bg-white/[0.07] hover:bg-white/[0.13] hover:text-primary border border-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_rgba(0,0,0,0.3)] transition-all duration-200"
          aria-haspopup="menu"
          aria-label="Lyrics provider"
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          {serving() && <Check size={13} class="flex-none text-key" aria-hidden="true" />}
          <span class="max-w-32 truncate">{label()}</span>
          {lyricsStore.syncOffsetMs !== 0 && (
            <span class="font-mono text-[10px] text-amber-300 font-bold px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-400/30">
              {lyricsStore.syncOffsetMs > 0 ? `+${(lyricsStore.syncOffsetMs / 1000).toFixed(2)}s` : `${(lyricsStore.syncOffsetMs / 1000).toFixed(2)}s`}
            </span>
          )}
          {props.loading ? <LoadingDots small /> : <ChevronDown size={14} />}
        </button>
      </div>
      {anchor() && (
        <Menu anchor={anchor()!} placement="below-end" onClose={close} label="Lyrics provider">
          <MenuItem checked={!props.picked} onSelect={() => (close(), props.onPick(null))}>
            Best available
          </MenuItem>
          <MenuItem onSelect={() => (close(), props.onFindBest())}>
            Find best lyrics again
          </MenuItem>
          <MenuSeparator />
          <MenuHeader>Providers with this song</MenuHeader>
          {/* Only providers that actually answered are listed, so every row opens real lyrics. */}
          {[
            ...(props.result?.primary ? [{ source: props.result.primary.source, tier: props.result.primary.estimated ? 'estimated' : props.result.primary.isWordSynced ? 'word' : 'line' }] : []),
            ...alternates(),
          ].map((entry) => (
            <MenuItem
              checked={props.picked ? props.picked.toLowerCase() === entry.source.toLowerCase() : props.result?.primary?.source === entry.source}
              trailing={<span class="type-caption-2">{TIER_LABEL[entry.tier] ?? entry.tier}</span>}
              onSelect={() => (close(), props.onPick(entry.source))}
            >
              {entry.source}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuHeader>Switch to provider</MenuHeader>
          {ALL_KNOWN_PROVIDERS.filter((p) => {
            const currentSource = props.result?.primary?.source?.toLowerCase() || '';
            const alts = alternates().map((a) => a.source.toLowerCase());
            return !currentSource.includes(p.toLowerCase()) && !alts.some((a) => a.includes(p.toLowerCase()));
          }).map((p) => (
            <MenuItem
              checked={props.picked?.toLowerCase() === p.toLowerCase()}
              onSelect={() => (close(), props.onPick(p))}
            >
              {p}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuHeader>Timing offset seek bar</MenuHeader>
          <div class="flex flex-col gap-3 px-3 py-2.5 text-xs text-secondary min-w-[260px]">
            <div class="flex items-center justify-between">
              <span class="font-mono text-primary font-bold tracking-tight text-[13px]">
                {lyricsStore.syncOffsetMs > 0 ? `+${lyricsStore.syncOffsetMs}ms` : `${lyricsStore.syncOffsetMs}ms`}
                {lyricsStore.syncOffsetMs !== 0 && (
                  <span class="text-white/50 text-[11px] font-normal ml-1.5">
                    ({lyricsStore.syncOffsetMs > 0 ? `+` : ''}{(lyricsStore.syncOffsetMs / 1000).toFixed(2)}s)
                  </span>
                )}
              </span>
              <button
                type="button"
                class="rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-0.5 text-[11px] font-medium text-primary hover:text-white transition active:scale-95 cursor-pointer border border-white/10"
                onClick={() => lyricsStore.setSyncOffset(0)}
              >
                Reset
              </button>
            </div>
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-[10px] text-white/40">-5s</span>
              <input
                type="range"
                min="-5000"
                max="5000"
                step="25"
                value={lyricsStore.syncOffsetMs}
                onInput={(e) => lyricsStore.setSyncOffset(parseInt(e.currentTarget.value, 10))}
                class="w-full h-2 bg-white/15 rounded-full appearance-none cursor-pointer accent-white hover:accent-amber-300 focus:outline-none transition-all shadow-inner"
              />
              <span class="font-mono text-[10px] text-white/40">+5s</span>
            </div>
            <div class="grid grid-cols-6 gap-1 pt-1 text-[10px] font-mono">
              <button
                type="button"
                class="rounded-md bg-white/8 hover:bg-white/16 active:bg-white/25 py-1 text-center text-primary border border-white/10 hover:border-white/20 transition active:scale-95"
                onClick={() => lyricsStore.setSyncOffset((lyricsStore.syncOffsetMs || 0) - 500)}
                title="Shift lyrics earlier by 500ms"
              >
                -0.5s
              </button>
              <button
                type="button"
                class="rounded-md bg-white/8 hover:bg-white/16 active:bg-white/25 py-1 text-center text-primary border border-white/10 hover:border-white/20 transition active:scale-95"
                onClick={() => lyricsStore.setSyncOffset((lyricsStore.syncOffsetMs || 0) - 100)}
                title="Shift lyrics earlier by 100ms"
              >
                -100
              </button>
              <button
                type="button"
                class="rounded-md bg-white/8 hover:bg-white/16 active:bg-white/25 py-1 text-center text-primary border border-white/10 hover:border-white/20 transition active:scale-95"
                onClick={() => lyricsStore.setSyncOffset((lyricsStore.syncOffsetMs || 0) - 25)}
                title="Fine-tune earlier by 25ms"
              >
                -25
              </button>
              <button
                type="button"
                class="rounded-md bg-white/8 hover:bg-white/16 active:bg-white/25 py-1 text-center text-primary border border-white/10 hover:border-white/20 transition active:scale-95"
                onClick={() => lyricsStore.setSyncOffset((lyricsStore.syncOffsetMs || 0) + 25)}
                title="Fine-tune later by 25ms"
              >
                +25
              </button>
              <button
                type="button"
                class="rounded-md bg-white/8 hover:bg-white/16 active:bg-white/25 py-1 text-center text-primary border border-white/10 hover:border-white/20 transition active:scale-95"
                onClick={() => lyricsStore.setSyncOffset((lyricsStore.syncOffsetMs || 0) + 100)}
                title="Shift lyrics later by 100ms"
              >
                +100
              </button>
              <button
                type="button"
                class="rounded-md bg-white/8 hover:bg-white/16 active:bg-white/25 py-1 text-center text-primary border border-white/10 hover:border-white/20 transition active:scale-95"
                onClick={() => lyricsStore.setSyncOffset((lyricsStore.syncOffsetMs || 0) + 500)}
                title="Shift lyrics later by 500ms"
              >
                +0.5s
              </button>
            </div>
          </div>
        </Menu>
      )}
        <div class="flex items-center gap-1.5">
          <button
            class="grid size-8 place-items-center rounded-[8px] text-secondary hover:text-primary hover:bg-white/[0.1] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-all duration-200 active:scale-90 aria-pressed:bg-white/[0.16] aria-pressed:text-primary aria-pressed:shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
            aria-label="Toggle romanized lyrics"
            aria-pressed={props.romanization}
            title="Romanization"
            onClick={props.onRomanization}
          >
            <Type size={16} />
          </button>
          <button
            class="grid size-8 place-items-center rounded-[8px] text-secondary hover:text-primary hover:bg-white/[0.1] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-all duration-200 active:scale-90 aria-pressed:bg-white/[0.16] aria-pressed:text-primary aria-pressed:shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
            aria-label="Toggle lyric translation"
            aria-pressed={props.translation}
            title="Translation"
            onClick={props.onTranslation}
          >
            <Languages size={16} />
          </button>
        </div>
    </div>
  );
}

const TIER_LABEL: Record<string, string> = { word: 'word-synced', line: 'line-synced', plain: 'plain', estimated: 'estimated timing' };

/**
 * One timed-upgrade watcher per song.
 *
 * The side panel and the player's one-line preview read the same result, so
 * without this both would watch the same song and double the requests.
 */
const upgradeWatchers = new Set<string>();

/** The playing track's lyrics: the engine's best sheet, or the one picked for it. */
export function useLyricsResult() {
  const current = () => playerStore.current;
  const key = () => {
    const track = current();
    return track ? `${track.id}|${track.title}|${(track.artists || []).join(', ')}` : '';
  };
  const requestKey = () => {
    const track = current();
    return track ? `${key()}|${track.duration}` : '';
  };
  // The pick has to be *read from the store*, not read through a getter: a
  // getter returns the same function every time, so the panel never heard
  // about a change and the new provider was never asked for.
  const pick = createMemo(() => {
    const k = key();
    return (k ? lyricsStore.picks[k] : undefined) ?? NO_PICK;
  });
  const only = createMemo(() => pick().source);
  const retry = createMemo(() => pick().retry);
  const forceRefresh = createMemo(() => pick().forceRefresh);
  const upgradeAttempt = createMemo(() => pick().upgradeAttempt);

  const query = useQuery(() => ({
    queryKey: ['lyrics', requestKey(), only(), retry(), upgradeAttempt()],
    enabled: !!current(),
    // A timed sheet is final; a plain one is provisional, so it goes stale
    // quickly and the next look asks the engine for timing again.
    staleTime: (q: any) =>
      q.state.data?.upgrading ? 0 : q.state.data?.status === 'ok' && q.state.data.primary?.isSynced ? Infinity : 15_000,
    gcTime: 30 * 60_000,
    retry: (failureCount: number, failure: Error) =>
      failureCount < 1 && !(failure instanceof Error && failure.message === 'HTTP 404'),
    retryDelay: (attempt: number) => Math.min(600 * 2 ** attempt, 1500),
    // Keep a same-track timed sheet mounted during an upgrade lookup.
    placeholderData: (previous: any, previousQuery: any) =>
      previousQuery?.queryKey[1] === requestKey() ? previous : undefined,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.lyrics(current()!, { source: only() ?? undefined, refresh: forceRefresh() }, signal),
  }));


  // The server answers with its first sheet and keeps hunting for word timing behind it
  // (`upgrading: true`). Poll its cache every second until it says the hunt is over; the better sheet
  // is swapped in the moment it lands. A manual pick is the listener's answer and is never polled.
  createEffect(() => {
    const source = only();
    const upgrading = !!query.data?.upgrading;
    const rk = requestKey();
    if (source || !upgrading || !rk) return;
    if (upgradeWatchers.has(rk)) return;
    upgradeWatchers.add(rk);
    let cancelled = false;
    let timer = 0;
    let tries = 0;
    const tick = async () => {
      if (cancelled) return;
      await query.refetch();
      if (cancelled) return;
      const next = queryClient.getQueryData<LyricsResult | null>(['lyrics', requestKey(), only(), retry(), upgradeAttempt()]);
      if (!next?.upgrading || ++tries >= 16) return;
      timer = window.setTimeout(tick, 900);
    };
    timer = window.setTimeout(tick, 700);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
      upgradeWatchers.delete(rk);
    });
  });

  // A provider picked by hand that has nothing for this song must not wipe the sheet already on
  // screen with a "not available" message: say so once, and go back to the best sheet (already cached).
  createEffect(() => {
    const source = only();
    const data = query.data;
    if (!source || query.isFetching || data?.status !== 'none' || data.reason !== 'source') return;
    const k = key();
    if (!k) return;
    playerStore.showToast?.(`${data.source || source} has no lyrics for this song`);
    lyricsStore.setPick(k, { source: null, forceRefresh: false, upgradeAttempt: 0 });
  });

  return {
    query,
    picked: only,
    pick: (source: string | null) => {
      const k = key();
      if (!k) return;
      // A new provider is a new sheet: the upgrade counter resets so the poll
      // starts over for it, and a stale refresh flag does not carry over.
      lyricsStore.setPick(k, { source, forceRefresh: false, upgradeAttempt: 0 });
    },
    findBest: () => {
      const k = key();
      if (!k) return;
      lyricsStore.setPick(k, { source: null, forceRefresh: true, retry: pick().retry + 1, upgradeAttempt: 0 });
    },
  };
}

const LOADING_MESSAGES = [
  'Syncing lyrics…',
  'Pulling the lyric sheet…',
  'Matching beat & bars…',
  'Fetching timed lyrics…',
];

const VOCAL_MESSAGES = [
  'Cue the vocals…',
  'Vocals incoming…',
  'Get ready to sing…',
  'Waiting for the verse…',
];

/** The one-line lyric that sits above the seek bar in the full-screen player. Synced sheets only. */
export function LyricPreview() {
  const { query } = useLyricsResult();
  const trackId = () => playerStore.current?.id;
  const duration = () => playerStore.current?.duration || 0;
  const playing = () => playerStore.playing;
  const [timeMs, setTimeMs] = createSignal(audio.currentTime * 1000);

  createEffect(() => {
    trackId();
    setTimeMs(audio.currentTime * 1000);
  });

  // Which line is current only needs a tenth of a second; the words are painted separately, every frame.
  createEffect(() => {
    trackId();
    const sync = () => setTimeMs(audio.currentTime * 1000);
    audio.addEventListener('seeking', sync);
    audio.addEventListener('seeked', sync);
    let timer = 0;
    if (playing()) timer = window.setInterval(sync, 100);
    onCleanup(() => {
      clearInterval(timer);
      audio.removeEventListener('seeking', sync);
      audio.removeEventListener('seeked', sync);
    });
  });

  const primary = createMemo(() =>
    query.data?.status === 'ok' && query.data.primary?.isSynced ? query.data.primary : null,
  );
  const lines = createMemo(() =>
    (primary()?.lines || []).filter((line) => !line.section && line.text?.some((part) => part.text?.trim())),
  );

  const effectiveMs = () => timeMs() + (lyricsStore.syncOffsetMs || 0);

  const state = createMemo<'lyric' | 'instrumental' | 'vocals' | 'loading' | 'unavailable' | null>(() => {
    const sheet = primary();
    const all = lines();
    const ms = effectiveMs();
    if (!trackId()) return null;
    const activeIndex = sheet?.isSynced
      ? all.findIndex((line) => line.timestamp <= ms && (!line.endtime || line.endtime > ms))
      : -1;
    const nextIndex = sheet?.isSynced ? all.findIndex((line) => line.timestamp > ms) : -1;
    const lineIndex = sheet?.isSynced ? (activeIndex >= 0 ? activeIndex : nextIndex) : all.length ? 0 : -1;
    const line = lineIndex >= 0 ? all[lineIndex] : null;
    const parts = line?.text.filter((part) => part.text?.trim()) || [];
    const text = parts.map((part) => part.text).join('').replace(/\s+/g, ' ').trim();
    const isInstrumentalMarker = /^\s*[\[(]?(?:instrumental|music|♪+|♫+|♬+)[\])]?\s*$/i.test(text);

    if (line && (activeIndex >= 0 || !sheet?.isSynced)) return isInstrumentalMarker ? 'instrumental' : 'lyric';
    if (!sheet && (query.isPending || query.isFetching)) return 'loading';
    if (!sheet && (query.data || query.isError)) return 'unavailable';
    if (sheet && lineIndex >= 0 && nextIndex === 0) return 'vocals';
    if (sheet && lineIndex >= 0 && nextIndex > 0 && line!.timestamp - ms > 1700) return 'instrumental';
    if (sheet && nextIndex < 0 && duration() > 0 && ms < duration() * 1000 - 1200) return 'instrumental';
    if (line && activeIndex < 0 && nextIndex >= 0 && line.timestamp - ms <= 1700) return 'lyric';
    return null;
  });

  const lineIndex = createMemo(() => {
    const sheet = primary();
    const all = lines();
    const ms = effectiveMs();
    if (!sheet?.isSynced) return all.length ? 0 : -1;
    const activeIndex = all.findIndex((line) => line.timestamp <= ms && (!line.endtime || line.endtime > ms));
    if (activeIndex >= 0) return activeIndex;
    const nextIndex = all.findIndex((line) => line.timestamp > ms);
    return nextIndex >= 0 ? nextIndex : all.length - 1;
  });
  const line = createMemo(() => {
    const index = lineIndex();
    return index >= 0 ? lines()[index] : null;
  });
  const parts = createMemo(() => line()?.text.filter((part) => part.text?.trim()) || []);
  const wordTimced = createMemo(
    () =>
      state() === 'lyric' &&
      !!primary()?.isWordSynced &&
      parts().length > 1 &&
      parts().some((part) => !part.lineSynced && part.endtime > part.timestamp) &&
      new Set(parts().map((p) => `${p.timestamp}|${p.endtime}`)).size > 1,
  );
  let words: HTMLParagraphElement | undefined;
  // The sung part of each word, written straight to its element once per frame
  // while the song moves (and once when it is paused or sought).
  createEffect(() => {
    const el = words;
    const timed = wordTimced();
    const list = parts();
    const current = line();
    if (!el || !timed || !current) return;
    const spans = Array.from(el.children) as HTMLElement[];
    const written: number[] = [];
    const clock = new LyricClock(Math.trunc(audio.currentTime * 1000));
    let frame = 0;
    let discontinuity = 0;
    const draw = () => {
      frame = 0;
      const now = performance.now();
      const rawAudioMs = Math.max(0, Math.trunc(audio.currentTime * 1000) + (lyricsStore.syncOffsetMs || 0));
      const ms = clock.frame(now, rawAudioMs, now, discontinuity);
      list.forEach((part, i) => {
        const start = part.timestamp || current.timestamp;
        const end = part.endtime > start ? part.endtime : start + 1;
        const value = Math.max(0, Math.min(1, (ms - start) / (end - start)));
        const span = spans[i];
        if (span && Math.abs((written[i] ?? -1) - value) > 0.002) {
          written[i] = value;
          span.style.setProperty('--fill', value.toFixed(3));
          const live = value > 0.02 && value < 0.98;
          if (live) span.dataset.live = 'true';
          else delete span.dataset.live;
        }
      });
      if (!audio.paused) frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame) {
        clock.restart();
        frame = requestAnimationFrame(draw);
      }
    };
    const onSeek = () => {
      discontinuity++;
      wake();
    };
    draw();
    audio.addEventListener('play', wake);
    audio.addEventListener('playing', wake);
    audio.addEventListener('seeked', onSeek);
    audio.addEventListener('seeking', onSeek);
    audio.addEventListener('timeupdate', wake);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('play', wake);
      audio.removeEventListener('playing', wake);
      audio.removeEventListener('seeked', onSeek);
      audio.removeEventListener('seeking', onSeek);
      audio.removeEventListener('timeupdate', wake);
    });
  });

  const text = createMemo(() => parts().map((part) => part.text).join('').replace(/\s+/g, ' ').trim());

  const loadingMsg = createMemo(() => {
    const id = trackId() || '';
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return LOADING_MESSAGES[Math.abs(hash) % LOADING_MESSAGES.length];
  });

  const vocalMsg = createMemo(() => {
    const id = trackId() || '';
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 37 + id.charCodeAt(i)) | 0;
    return VOCAL_MESSAGES[Math.abs(hash) % VOCAL_MESSAGES.length];
  });

  let outer: HTMLDivElement | undefined;
  let box: HTMLDivElement | undefined;

  // One line, always: the type steps down to fit the width (never below 12px), and what still
  // does not fit fades out at the edge instead of wrapping.
  const BASE = 15;

  const fit = () => {
    if (!outer || !box) return;
    box.style.fontSize = `${BASE}px`;
    const room = outer.clientWidth;
    const need = box.scrollWidth;
    if (!room || !need) return;
    const size = Math.max(12, Math.min(BASE, (BASE * room) / need));
    box.style.fontSize = `${size.toFixed(2)}px`;
    outer.dataset.overflow = box.scrollWidth > room + 1 ? 'true' : 'false';
  };
  onMount(() => {
    if (!outer) return;
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    onCleanup(() => observer.disconnect());
  });

  // Smooth motionless crossfade to the next line without any vertical jumping.
  createEffect(
    on(
      [lineIndex, state, trackId],
      () => {
        queueMicrotask(() => {
          fit();
          if (!box || matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
          box.animate(
            [
              { opacity: 0, transform: 'translate3d(0, 5px, 0) scale(0.988)' },
              { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
            ],
            { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
        });
      },
      { defer: true },
    ),
  );

  return (
    <div
      ref={outer}
      class="fs-oneline"
      role="status"
      aria-live="polite"
      aria-label={state() === 'lyric' ? 'Current lyric' : 'Lyrics'}
      data-overflow="false"
    >
      <div
        ref={box}
        class="fs-oneline-line"
        style={{
          'font-family': "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif !important",
          'font-weight': '700',
          'letter-spacing': '-0.022em',
        }}
      >
        <Show when={state() === 'lyric'}>
          {wordTimced() ? (
            <p
              ref={words}
              class="fs-oneline-words"
              dir={line()!.direction === 'rtl' ? 'rtl' : undefined}
            >
              <For each={parts()}>{(part) => <span class="lyric-word">{part.text}</span>}</For>
            </p>
          ) : (
            <p class="fs-oneline-words fs-oneline-words--solid">{text()}</p>
          )}
        </Show>
        <Show when={state() === 'instrumental'}>
          <div class="inline-flex items-center gap-2 text-white/95 font-bold tracking-tight text-[15px]">
            <svg class="size-4.5 text-white inline-block -mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" fill="currentColor" />
              <circle cx="18" cy="16" r="3" fill="currentColor" />
            </svg>
            <span class="fs-oneline-words fs-oneline-words--solid text-[15px] font-bold">Instrumental break</span>
          </div>
        </Show>
        <Show when={state() === 'vocals'}>
          <div class="inline-flex items-center gap-2 text-white/90 font-bold tracking-tight text-[15px]">
            <span class="fs-oneline-words fs-oneline-words--solid text-[15px]">{vocalMsg()}</span>
          </div>
        </Show>
        <Show when={state() === 'loading'}>
          <div class="inline-flex items-center gap-2 text-white/70 font-semibold tracking-tight text-[14px]">
            <LoadingDots small />
            <span class="fs-oneline-words fs-oneline-words--solid text-[14px]">{loadingMsg()}</span>
          </div>
        </Show>
      </div>
    </div>
  );
}

/**
 * The next track's lyrics, warmed.
 *
 * The panel is already holding the words when the track changes, so the
 * switch from one song's lyrics to the next's is a fade rather than a wait.
 */
export function usePrefetchNextLyrics() {
  createEffect(() => {
    const next = playerStore.nextTrack();
    if (!next) return;
    const key = `${next.id}|${next.title}|${(next.artists || []).join(', ')}|${next.duration}`;
    void queryClient
      .prefetchQuery({
        // The key has to be the one the panel will ask for, or the warmed
        // sheet is stored under a name nothing ever reads.
        queryKey: ['lyrics', key, null, 0, 0],
        queryFn: ({ signal }) => api.lyrics(next, {}, signal),
        staleTime: 10 * 60_000,
      })
      .catch(() => {});
  });
}

/**
 * The plain sheet — the one with no timing behind it.
 *
 * A synced sheet is carried by the paint: the word lights up as the music
 * reaches it, and the eye needs no help. A plain sheet has nothing but the
 * words, so the column has to carry the reading itself: a measure of text
 * that is left alone, the song's own section headings given room to breathe,
 * a rule that marks the line in the middle of the frame, and edges that fade
 * instead of simply stopping.
 *
 * The middle line is found from cached offsets, not from live measurements:
 * reading forty boxes on every scroll frame is what makes a plain sheet feel
 * heavy, and the reader notices the stutter long before the highlight.
 */
function PlainLyrics(props: { lines: LyricsLine[]; source: string; full: boolean }) {
  let scroller!: HTMLDivElement;
  const rows: (HTMLParagraphElement | null)[] = [];
  let offsets: { top: number; height: number }[] = [];
  const [active, setActive] = createSignal(-1);

  const measure = () => {
    const base = scroller.getBoundingClientRect().top;
    offsets = rows.map((row) => {
      const box = row?.getBoundingClientRect();
      if (!box) return { top: 0, height: 0 };
      return { top: box.top - base + scroller.scrollTop, height: box.height };
    });
  };

  onMount(() => {
    let frame = 0;
    const pick = () => {
      frame = 0;
      const middle = scroller.scrollTop + scroller.clientHeight * 0.38;
      let found = -1;
      for (let i = 0; i < offsets.length; i++) {
        const row = offsets[i]!;
        if (!row.height) continue;
        if (middle >= row.top && middle <= row.top + row.height) {
          found = i;
          break;
        }
      }
      if (found < 0) {
        // Between two lines: keep the one that is closest.
        let best = -1;
        let distance = Infinity;
        for (let i = 0; i < offsets.length; i++) {
          const row = offsets[i]!;
          if (!row.height) continue;
          const gap = Math.abs(row.top + row.height / 2 - middle);
          if (gap < distance) {
            distance = gap;
            best = i;
          }
        }
        found = best;
      }
      setActive((current) => (current === found ? current : found));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(pick);
    };
    const remeasure = () => {
      measure();
      pick();
    };
    remeasure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    observer?.observe(scroller);
    // The lyric face arrives after the first paint and moves every line.
    void document.fonts?.ready.then(remeasure).catch(() => undefined);
    onCleanup(() => {
      scroller.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    });
  });

  const size = () =>
    props.full
      ? 'text-[clamp(30px,3.6vw,54px)] leading-[1.12] font-bold tracking-[-0.036em]'
      : 'text-[27px] leading-[1.18] font-bold tracking-[-0.03em]';

  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          class={`mx-auto w-full ${props.full ? 'max-w-[46rem]' : 'max-w-[34rem]'} px-6 sm:px-8 ${
            props.full ? 'pt-12 pb-40' : 'pt-5 pb-24'
          }`}
          style={{ 'font-family': "-apple-system, BlinkMacSystemFont, 'SF Pro Rounded', 'SF Pro Display', 'SF Pro Text', 'SF Pro', 'Helvetica Neue', system-ui, sans-serif" }}
        >
          {props.lines.map((line, index) => {
            const text = line.text.map((part) => part.text).join('').trim();
            if (line.section) {
              return (
                <p class="pt-8 pb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-secondary/60 first:pt-0">
                  {text}
                </p>
              );
            }
            if (!text) return null;
            const isActive = () => active() === index;
            return (
              <p
                ref={(node) => {
                  rows[index] = node;
                }}
                class={`animate-lyric-rise mb-[0.42em] cursor-default transition-[color,text-shadow] duration-500 ease-out motion-reduce:animate-none ${size()} ${
                  isActive() ? 'text-white' : 'text-white/36 hover:text-white/70'
                }`}
                style={{ 'animation-delay': `${Math.min(index, 16) * 34}ms` }}
              >
                {text}
              </p>
            );
          })}

        </div>
      </div>
    </div>
  );
}

const panel = 'group/panel relative isolate flex min-h-0 flex-1 flex-col overflow-hidden';
// The full-screen player's column (report §7): lines 26px, then 30px from 980px, 36px from 1320px and 42px from 1680px.
const fullSizes =
  '[--mc-lyric-size:30px] min-[980px]:[--mc-lyric-size:36px] min-[1320px]:[--mc-lyric-size:42px] min-[1680px]:[--mc-lyric-size:48px]';

/**
 * The lyrics, with their provider picker and empty states: the side panel
 * (report §7), and the right-hand column of the full-screen player, where the
 * lines are larger and the player's mesh stands behind them.
 */
export function LyricsPanel(props: { variant?: 'panel' | 'full' }) {
  const hasTrack = createMemo(() => playerStore.current !== null);
  const fontReady = useLyricFont();
  const { query, picked, pick, findBest } = useLyricsResult();
  const romanization = () => lyricsStore.showRomanization;
  const translation = () => lyricsStore.showTranslation;
  // The next song's words, warmed while this one plays.
  usePrefetchNextLyrics();
  // Stale/provider-selected plain transcripts do not replace true timed lyrics.
  const result = createMemo<LyricsResult | null>(() =>
    query.data?.status === 'ok' && query.data.primary?.lines?.length ? query.data : null,
  );
  const full = () => props.variant === 'full';
  const empty = () =>
    full()
      ? 'flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center type-title-3 text-secondary'
      : 'flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-20 text-center type-[400_12px/16px] text-secondary';
  const emptyTitle = () => (full() ? 'type-title-1-emphasized text-primary' : 'type-[600_12px/16px]');

  const timed = createMemo(() => (result()?.primary?.isSynced ? result()!.primary! : null));
  const timedLines = createMemo<LyricsLine[]>(() => timed()?.lines ?? []);

  return (
    <div class={`${panel} ${full() ? fullSizes : ''}`}>
      <ProviderPicker
        result={result()}
        picked={picked()}
        onPick={pick}
        onFindBest={findBest}
        loading={query.isFetching}
        full={full()}
        romanization={romanization()}
        translation={translation()}
        onRomanization={() => lyricsStore.setShowRomanization(!romanization())}
        onTranslation={() => lyricsStore.setShowTranslation(!translation())}
      />
      <Show
        when={hasTrack()}
        fallback={
          <div class={empty()}>
            <p class={emptyTitle()}>No lyrics available</p>
            <p>Play a song to see its lyrics here.</p>
          </div>
        }
      >
        <Show
          when={!(query.isPending || (timed() && !fontReady()))}
          fallback={
            <div class={empty()} role="status" aria-live="polite">
              <div class="flex items-center gap-2">
                <p class="type-title-3-emphasized text-primary">Finding lyrics</p>
                <LoadingDots />
              </div>
              <p class="max-w-56 type-callout text-secondary">Searching lyric sources</p>
            </div>
          }
        >
          <Show
            when={timed()}
            fallback={
              <Show
                when={result()?.primary}
                fallback={
                  <Show
                    when={query.data?.reason === 'source'}
                    fallback={
                      <Show
                        when={query.isError}
                        fallback={
                          <div class={empty()}>
                            <p class={emptyTitle()}>No lyrics available</p>
                            <p>None of the lyric providers had a sheet for this song.</p>
                            <button
                              class="mt-2 inline-flex items-center gap-2 rounded-full bg-thin-material px-4 py-2 type-callout-emphasized text-primary hover:bg-quinary disabled:opacity-50"
                              disabled={query.isFetching}
                              onClick={findBest}
                            >
                              {query.isFetching ? (
                                <>
                                  <span>Searching sources</span>
                                  <LoadingDots small />
                                </>
                              ) : (
                                <>
                                  <RotateCw size={14} />
                                  <span>Find best lyrics</span>
                                </>
                              )}
                            </button>
                          </div>
                        }
                      >
                        <div class={empty()} role="alert">
                          <p class={emptyTitle()}>Lyrics couldn’t load</p>
                          <p>The lyric sources didn’t respond. Try again in a moment.</p>
                          <button
                            class="mt-2 inline-flex items-center gap-2 rounded-full bg-thin-material px-4 py-2 type-callout-emphasized text-primary hover:bg-quinary disabled:opacity-50"
                            disabled={query.isFetching}
                            onClick={findBest}
                          >
                            <RotateCw size={14} />
                            <span>Try again</span>
                          </button>
                        </div>
                      </Show>
                    }
                  >
                    <div class={empty()}>
                      <p class={emptyTitle()}>{query.data?.source || 'That provider'} has no lyrics for this song</p>
                      <p>Another provider may still have them.</p>
                      <button
                        class="mt-2 inline-flex items-center gap-2 rounded-full bg-thin-material px-4 py-2 type-callout-emphasized text-primary hover:bg-quinary disabled:opacity-50"
                        disabled={query.isFetching}
                        onClick={findBest}
                      >
                        {query.isFetching ? (
                          <>
                            <span>Finding lyrics</span>
                            <LoadingDots small />
                          </>
                        ) : (
                          <>
                            <RotateCw size={14} />
                            <span>Use the best available</span>
                          </>
                        )}
                      </button>
                    </div>
                  </Show>
                }
              >
                <Show
                  when={picked()}
                  fallback={
                    <div class={empty()}>
                      <p class={emptyTitle()}>No synced lyrics for this song</p>
                      <p>Pick a provider from the menu above to read plain, unsynced lyrics.</p>
                      <button
                        class="mt-2 inline-flex items-center gap-2 rounded-full bg-thin-material px-4 py-2 type-callout-emphasized text-primary hover:bg-quinary disabled:opacity-50"
                        disabled={query.isFetching}
                        onClick={findBest}
                      >
                        {query.isFetching ? (
                          <>
                            <span>Searching sources</span>
                            <LoadingDots small />
                          </>
                        ) : (
                          <>
                            <RotateCw size={14} />
                            <span>Find synced lyrics</span>
                          </>
                        )}
                      </button>
                    </div>
                  }
                >
                  <PlainLyrics
                    lines={result()!.primary!.lines}
                    source={result()!.primary!.source}
                    full={full()}
                  />
                </Show>
              </Show>
            }
          >
            <Suspense fallback={<div class={empty()} role="status"><LoadingDots /></div>}>
              <AmLyricsView
                lines={timedLines()}
                full={full()}
                fontFamily={LYRIC_FONT}
                translation={translation()}
                romanization={romanization()}
              />
            </Suspense>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
