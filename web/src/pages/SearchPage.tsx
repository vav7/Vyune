/* SearchPage.tsx — Search, laid out with filter chips, typeahead and instant results.
 *
 *   field empty              → Recent searches (typed queries and opened results)
 *   field changed, unsent    → up to three suggestions, then live typeahead rows
 *   submitted                → filter chips, then
 *       All                  → the promoted Top result card, then Songs / Artists /
 *                              Albums / Playlists sections in YouTube's own order
 *       any other chip       → that one list
 *   the list grows as it is scrolled (the response's own continuation token).
 *
 * Nothing here scores or re-orders rows: what YouTube Music returns is shown. */

import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useQuery } from '@tanstack/solid-query';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { ListEnd, Play, X } from 'lucide-solid';
import { PrefetchLink } from '@/components/PrefetchLink';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';
import { Artwork } from '@/components/music/Artwork';
import { TrackMenu } from '@/components/music/TrackMenu';
import { formatDuration, hrefFor } from '@/components/music/links';
import { playList, playTrack } from '@/components/music/play';
import { SearchBar } from '@/components/search/SearchBar';
import { api } from '@/lib/api';
import { playerStore } from '@/store/player';
import { searchHistory, type HistoryEntry } from '@/store/searchHistory';
import type { Card, SearchFilter, SearchRow, Track } from '@/lib/types';

type BrowseItem = Card & { kind: 'artist' | 'album' | 'playlist' };

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

const isFilter = (value: unknown): value is SearchFilter => FILTERS.some((f) => f.id === value);

const rowKey = (row: SearchRow) => (row.kind === 'browse' ? `b:${row.item.id}` : `v:${row.track.id}`);

/* ---------------------------------------------------------------- */
/* Rows                                                              */
/* ---------------------------------------------------------------- */

const rowBase =
  'group relative flex w-full items-center gap-3.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07]';

function PlayingBars() {
  return (
    <span class="sr-bars" aria-label="Playing">
      <i /><i /><i />
    </span>
  );
}

function VideoThumb(props: { src?: string | null; size: number }) {
  return (
    <div
      class="relative flex-none overflow-hidden rounded-[6px] bg-white/[0.08]"
      style={{ width: `${Math.round(props.size * 1.78)}px`, height: `${props.size}px` }}
    >
      <Show when={props.src}>
        <img src={props.src!} alt="" loading="lazy" decoding="async" class="size-full object-cover" />
      </Show>
    </div>
  );
}

function SongRow(props: { track: Track; onPlay: () => void }) {
  const current = () => playerStore.current?.id === props.track.id;
  const artists = () => (props.track.artists?.length ? props.track.artists.join(', ') : props.track.channel || '');
  const meta = () => [artists(), formatDuration(props.track.duration)].filter(Boolean).join(' · ');
  return (
    <div
      class={`${rowBase} ${current() ? 'bg-[rgba(250,45,79,0.14)] shadow-[inset_0_0_0_1px_rgba(250,45,79,0.32)]' : ''}`}
      onPointerEnter={() => playerStore.prefetch(props.track)}
      onFocusIn={() => playerStore.prefetch(props.track)}
    >
      <button class="flex min-w-0 flex-1 items-center gap-3.5 text-left outline-none" onClick={props.onPlay} aria-label={`Play ${props.track.title}`}>
        <div class="relative flex-none">
          <Show
            when={props.track.isVideo}
            fallback={
              <div class="w-12">
                <Artwork src={props.track.thumb} track={props.track} displayWidth={48} radius="6px" />
              </div>
            }
          >
            <VideoThumb src={props.track.thumb} size={48} />
          </Show>
          <Show when={current()}>
            <div class="absolute inset-0 grid place-items-center rounded-[6px] bg-black/45">
              <PlayingBars />
            </div>
          </Show>
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="flex items-center gap-1.5">
            <span class={`truncate type-body ${current() ? 'text-[#fa2d4f] font-semibold' : ''}`}>{props.track.title}</span>
            <Show when={props.track.explicit}>
              <span class="grid h-[14px] w-[14px] flex-none place-items-center rounded-[3px] bg-white/[0.28] text-[9px] font-bold leading-none text-black/80" title="Explicit">E</span>
            </Show>
          </span>
          <span class="truncate type-callout text-secondary">{meta()}</span>
        </div>
      </button>
      <TrackMenu
        track={props.track}
        class="grid size-9 flex-none place-items-center rounded-full text-secondary opacity-0 transition-opacity hover:text-primary group-hover:opacity-100 focus-visible:opacity-100 data-[open]:opacity-100 max-sm:opacity-100"
      />
    </div>
  );
}

function BrowseRow(props: { item: BrowseItem; onOpen?: () => void }) {
  const href = () => hrefFor(props.item.kind, props.item.id) || '/';
  const label = () => ({ artist: 'Artist', album: 'Album', playlist: 'Playlist' })[props.item.kind];
  const subtitle = () => {
    const sub = (props.item.subtitle || '').trim();
    // The byline already starts with the kind ("Album • Artist • 2021"): don't say it twice.
    const lower = sub.toLowerCase();
    return lower.startsWith(label().toLowerCase()) ? sub : [label(), sub].filter(Boolean).join(' · ');
  };
  return (
    <PrefetchLink to={href()} class={rowBase} onClick={() => props.onOpen?.()}>
      <div class="w-12 flex-none">
        <Artwork src={props.item.thumb} displayWidth={48} radius={props.item.kind === 'artist' ? '50%' : '6px'} />
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate type-body">{props.item.title}</span>
        <span class="truncate type-callout text-secondary">{subtitle()}</span>
      </div>
    </PrefetchLink>
  );
}

function SongSkeletonRow() {
  return (
    <div class="flex items-center gap-3.5 px-2 py-2" aria-hidden="true">
      <SkeletonBlock width="48px" height="48px" radius="6px" />
      <div class="flex flex-1 flex-col gap-1.5">
        <SkeletonLine lineHeight={18} fontSize={15} width="55%" />
        <SkeletonLine lineHeight={15} fontSize={12} width="35%" />
      </div>
    </div>
  );
}

const Skeletons = (props: { count: number }) => (
  <div aria-busy="true">
    <For each={Array.from({ length: props.count }, (_, i) => i)}>{() => <SongSkeletonRow />}</For>
  </div>
);

const SectionTitle = (props: { children: JSX.Element }) => (
  <h2 class="mx-2 mb-1 mt-5 type-title-3-emphasized">{props.children}</h2>
);

/* ---------------------------------------------------------------- */
/* Top result                                                        */
/* ---------------------------------------------------------------- */

function TopResultCard(props: { track: Track; onPlay: () => void }) {
  const isCurrent = () => playerStore.current?.id === props.track.id;
  const artists = () => (props.track.artists || []).join(', ');
  return (
    <div class={`mt-3 rounded-[16px] glass-card p-4 transition-all duration-200 ${isCurrent() ? 'ring-1 ring-[#fa2d4f]/60 bg-[rgba(250,45,79,0.08)]' : ''}`}>
      <div class="flex items-center gap-4">
        <div class="w-[72px] flex-none">
          <Artwork src={props.track.thumb} track={props.track} displayWidth={72} radius="8px" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class={`line-clamp-2 type-title-3 ${isCurrent() ? 'text-[#fa2d4f] font-semibold' : ''}`}>{props.track.title}</span>
          <span class="truncate type-callout text-secondary">
            {['Song', artists()].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
      <div class="mt-3.5 grid grid-cols-2 gap-2.5">
        <button
          class="inline-flex h-10 items-center justify-center gap-2 rounded-pill bg-key-bg type-body-emphasized text-white transition-[filter] hover:brightness-110"
          onClick={props.onPlay}
        >
          <Play size={16} fill="currentColor" strokeWidth={0} /> Play
        </button>
        <button
          class="inline-flex h-10 items-center justify-center gap-2 rounded-pill bg-white/[0.12] type-body-emphasized text-primary transition-colors hover:bg-white/[0.2]"
          onClick={() => playerStore.enqueue(props.track)}
        >
          <ListEnd size={16} /> Add to Queue
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Recent searches                                                   */
/* ---------------------------------------------------------------- */

function HistoryRow(props: { entry: HistoryEntry; onQuery: (q: string) => void; onTrack: (t: Track) => void }) {
  const e = () => props.entry;
  const open = () => {
    if (e().kind === 'query') return props.onQuery(e().title);
    if (e().kind === 'song' && e().track) return props.onTrack(e().track!);
  };
  const href = () => (e().kind === 'artist' || e().kind === 'album' || e().kind === 'playlist' ? hrefFor(e().kind as 'artist', e().id || '') : null);
  const inner = (
    <>
      <div class="grid size-12 flex-none place-items-center overflow-hidden" style={{ 'border-radius': e().kind === 'artist' ? '50%' : '6px' }}>
        <Show
          when={e().kind !== 'query'}
          fallback={
            <svg viewBox="0 0 24 24" class="size-6 text-secondary" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
          }
        >
          <Artwork src={e().thumb} displayWidth={48} radius={e().kind === 'artist' ? '50%' : '6px'} />
        </Show>
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate type-body">{e().title}</span>
        <Show when={e().subtitle}>
          <span class="truncate type-callout text-secondary">{e().subtitle}</span>
        </Show>
      </div>
    </>
  );
  return (
    <div class={rowBase}>
      <Show
        when={href()}
        fallback={<button class="flex min-w-0 flex-1 items-center gap-3.5 text-left outline-none" onClick={open}>{inner}</button>}
      >
        <PrefetchLink to={href()!} class="flex min-w-0 flex-1 items-center gap-3.5 outline-none">{inner}</PrefetchLink>
      </Show>
      <button
        class="grid size-9 flex-none place-items-center rounded-full text-secondary hover:text-primary"
        aria-label={`Remove ${e().title} from recent searches`}
        onClick={() => searchHistory.remove(e().key)}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Page                                                              */
/* ---------------------------------------------------------------- */

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();

  const submitted = () => (typeof params.q === 'string' ? params.q.trim() : '');
  const filter = (): SearchFilter => (isFilter(params.filter) ? params.filter : 'all');

  const [draft, setDraft] = createSignal(submitted());
  // Link-ins (/search?q=…) and back/forward move the URL: the field follows.
  createEffect(on(submitted, (q) => setDraft((d) => (d.trim() === q ? d : q)), { defer: true }));

  const view = () => {
    const text = draft().trim();
    if (!text) return 'recents' as const;
    return text === submitted() ? ('results' as const) : ('suggest' as const);
  };

  const leave = () => {
    if (window.history.length > 1) nav(-1);
    else nav('/');
  };
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"], .command-palette')) return;
      leave();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const submit = (text: string) => {
    const q = text.trim();
    if (!q) return;
    searchHistory.addQuery(q);
    setDraft(q);
    setParams({ q, filter: filter() === 'all' ? undefined : filter() }, { replace: true });
  };

  /* ---- suggestions + typeahead while typing ---- */
  const [suggestions, setSuggestions] = createSignal<string[]>([]);
  const [typeahead, setTypeahead] = createSignal<SearchRow[]>([]);
  createEffect(() => {
    if (view() !== 'suggest') return;
    const text = draft().trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.suggest(text, controller.signal).then((r) => setSuggestions(r.items || [])).catch(() => {});
      api.typeahead(text, controller.signal).then((r) => setTypeahead(r.rows || [])).catch(() => {});
    }, 180);
    onCleanup(() => {
      clearTimeout(timer);
      controller.abort();
    });
  });
  createEffect(on(() => draft().trim() === '', (empty) => { if (empty) batch(() => { setSuggestions([]); setTypeahead([]); }); }));

  const shownSuggestions = () => {
    const typed = draft().trim().toLowerCase();
    return suggestions().filter((s) => s.trim().toLowerCase() !== typed).slice(0, 3);
  };
  const typeaheadRows = () => typeahead().slice(0, 6);

  /* ---- results: the first page, then continuation pages ---- */
  const first = useQuery(() => ({
    queryKey: ['search-page', filter(), submitted()] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.searchPage(submitted(), filter(), signal),
    enabled: view() === 'results' && !!submitted(),
    retry: 1,
    retryDelay: 700,
    staleTime: (q: { state: { error: unknown } }) => (q.state.error ? 10_000 : 5 * 60_000),
  }));

  const [extra, setExtra] = createSignal<SearchRow[]>([]);
  const [token, setToken] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  createEffect(() => {
    const data = first.data;
    batch(() => {
      setExtra([]);
      setToken(data?.continuation ?? null);
      setLoadingMore(false);
    });
  });

  const rows = createMemo(() => {
    const seen = new Set<string>();
    const out: SearchRow[] = [];
    for (const row of [...(first.data?.rows || []), ...extra()]) {
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  });

  const loadMore = async () => {
    const t = token();
    if (!t || loadingMore()) return;
    setLoadingMore(true);
    try {
      const page = await api.searchMore(t, filter());
      batch(() => {
        setExtra((prev) => [...prev, ...page.rows]);
        setToken(page.continuation);
      });
    } catch {
      setToken(null); // a failed page ends the list quietly rather than looping
    } finally {
      setLoadingMore(false);
    }
  };

  const [sentinelEl, setSentinelEl] = createSignal<HTMLDivElement | null>(null);
  createEffect(() => {
    const el = sentinelEl();
    if (!el || view() !== 'results') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: el.closest('[data-search-scroll]'), rootMargin: '0px 0px 700px 0px' },
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  // A short first page can leave the sentinel in view with nothing to scroll: keep filling.
  createEffect(() => {
    rows();
    const el = sentinelEl();
    if (token() && el && !loadingMore()) {
      requestAnimationFrame(() => {
        const box = el?.closest('[data-search-scroll]') as HTMLElement | null;
        if (box && el && el.getBoundingClientRect().top < box.getBoundingClientRect().bottom + 700) void loadMore();
      });
    }
  });

  /* ---- grouped for the All page ---- */
  const topTrack = () => rows().find((r): r is Extract<SearchRow, { kind: 'top' }> => r.kind === 'top')?.track;
  const songs = () => rows().flatMap((r) => (r.kind === 'track' ? [r.track] : []));
  const playable = () => rows().flatMap((r) => (r.kind === 'top' || r.kind === 'track' ? [r.track] : []));
  const browse = (kind: BrowseItem['kind']) =>
    rows().flatMap((r) => (r.kind === 'browse' && r.item.kind === kind ? [r.item] : []));

  const playFrom = (track: Track) => {
    searchHistory.addTrack(track);
    const list = playable();
    const index = list.findIndex((t) => t.id === track.id);
    if (index >= 0) playList(list, index);
    else playTrack(track);
  };
  const remember = (item: BrowseItem) => searchHistory.addBrowse(item as Parameters<typeof searchHistory.addBrowse>[0]);

  const pickFilter = (next: SearchFilter) =>
    setParams({ q: submitted(), filter: next === 'all' ? undefined : next }, { replace: true });

  const Results = () => (
    <>
      <div class="sticky top-0 z-10 -mx-(--body-gutter) flex gap-2 overflow-x-auto px-(--body-gutter) py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Search filters">
        <For each={FILTERS}>
          {(f) => (
            <button
              role="tab"
              aria-selected={filter() === f.id}
              class={`h-8 flex-none rounded-pill px-3.5 type-callout-emphasized transition-colors ${
                filter() === f.id ? 'bg-white text-black' : 'bg-white/[0.1] text-primary hover:bg-white/[0.18]'
              }`}
              onClick={() => pickFilter(f.id)}
            >
              {f.label}
            </button>
          )}
        </For>
      </div>

      <Show when={!first.isError} fallback={
        <div class="mx-2 mt-10 text-center">
          <p class="type-title-3">Search is unavailable right now</p>
          <p class="mt-1 type-callout text-secondary">Check your connection and try again.</p>
          <button class="mt-4 inline-flex h-9 items-center rounded-pill bg-key-bg px-5 type-body-emphasized text-white" onClick={() => void first.refetch()}>Try Again</button>
        </div>
      }>
        <Show when={!first.isPending} fallback={<Skeletons count={8} />}>
          <Show
            when={rows().length > 0}
            fallback={
              <div class="mx-2 mt-10 text-center">
                <p class="type-title-3">No results</p>
                <p class="mt-1 type-callout text-secondary">Try a different spelling, or another filter.</p>
              </div>
            }
          >
            <Show
              when={filter() === 'all'}
              fallback={
                <div class="mt-1">
                  <For each={rows()}>
                    {(row) =>
                      row.kind === 'browse' ? (
                        <BrowseRow item={row.item as BrowseItem} onOpen={() => remember(row.item as BrowseItem)} />
                      ) : (
                        <SongRow track={row.track} onPlay={() => playFrom(row.track)} />
                      )
                    }
                  </For>
                </div>
              }
            >
              <Show when={topTrack()}>
                {(track) => (
                  <>
                    <SectionTitle>Top result</SectionTitle>
                    <TopResultCard track={track()} onPlay={() => playFrom(track())} />
                  </>
                )}
              </Show>
              <Show when={songs().length}>
                <SectionTitle>Songs</SectionTitle>
                <For each={songs()}>{(t) => <SongRow track={t} onPlay={() => playFrom(t)} />}</For>
              </Show>
              <For each={[['artist', 'Artists'], ['album', 'Albums'], ['playlist', 'Playlists']] as const}>
                {([kind, title]) => (
                  <Show when={browse(kind).length}>
                    <SectionTitle>{title}</SectionTitle>
                    <For each={browse(kind)}>{(item) => <BrowseRow item={item} onOpen={() => remember(item)} />}</For>
                  </Show>
                )}
              </For>
            </Show>
            <div ref={setSentinelEl} class="h-px" aria-hidden="true" />
            <Show when={loadingMore()}>
              <Skeletons count={3} />
            </Show>
          </Show>
        </Show>
      </Show>
    </>
  );

  const Suggest = () => (
    <div class="mt-1">
      <For each={shownSuggestions()}>
        {(text) => (
          <div class={rowBase}>
            <button class="flex min-w-0 flex-1 items-center gap-3.5 text-left outline-none" onClick={() => submit(text)}>
              <svg viewBox="0 0 24 24" class="ml-2 size-5 flex-none text-secondary" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <span class="truncate type-body">{text}</span>
            </button>
            <button class="grid size-9 flex-none place-items-center rounded-full text-secondary hover:text-primary" aria-label={`Use “${text}” in the search field`} onClick={() => setDraft(text)}>
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 17L7 7M7 15V7h8" /></svg>
            </button>
          </div>
        )}
      </For>
      <Show when={shownSuggestions().length && typeaheadRows().length}>
        <div class="mx-2 my-2 h-px bg-white/[0.1]" />
      </Show>
      <For each={typeaheadRows()}>
        {(row) =>
          row.kind === 'browse' ? (
            <BrowseRow item={row.item as BrowseItem} onOpen={() => remember(row.item as BrowseItem)} />
          ) : (
            <SongRow
              track={row.track}
              onPlay={() => {
                searchHistory.addTrack(row.track);
                const list = typeaheadRows().flatMap((r) => (r.kind === 'track' || r.kind === 'top' ? [r.track] : []));
                const at = list.findIndex((t) => t.id === row.track.id);
                if (at >= 0) playList(list, at);
                else playTrack(row.track);
              }}
            />
          )
        }
      </For>
    </div>
  );

  const Recents = () => (
    <Show
      when={searchHistory.entries().length}
      fallback={
        <div class="mx-2 mt-16 text-center">
          <p class="type-title-3">Search</p>
          <p class="mt-1 type-callout text-secondary">Find songs, artists, albums and playlists.</p>
        </div>
      }
    >
      <div class="mx-2 mb-1 mt-4 flex items-center justify-between">
        <h2 class="type-title-3-emphasized">Recent searches</h2>
        <button class="type-callout-emphasized text-key hover:underline" onClick={() => searchHistory.clear()}>Clear</button>
      </div>
      <For each={searchHistory.entries()}>
        {(entry) => (
          <HistoryRow
            entry={entry}
            onQuery={(q) => submit(q)}
            onTrack={(t) => {
              searchHistory.addTrack(t);
              playTrack(t);
            }}
          />
        )}
      </For>
    </Show>
  );

  // Search is a floating glass pane over the page, to the right of the sidebar: the sidebar stays
// visible and usable. (On a phone, where the sidebar is a drawer, the pane takes the whole screen.)
  // It is portalled out of the page so the page's entrance motion cannot pin a
  // fixed sheet to the page column.
  return (
    <Portal>
      <div
        class="search-sheet search-glass fixed top-1.5 right-1.5 bottom-1.5 left-[max(6px,var(--web-navigation-width))] z-[calc(var(--z-web-chrome)-2)] flex flex-col overflow-hidden rounded-[16px] bg-[rgb(12_12_22/0.16)] text-primary animate-[fade-in_200ms_ease-out_both] max-md:inset-0 max-md:rounded-none"
        role="dialog"
        aria-label="Search"
        data-search-sheet
      >
        <div class="relative z-20 flex h-[68px] flex-none items-center justify-center gap-3 px-(--body-gutter)">
          <SearchBar
            value={draft()}
            autofocus={!submitted()}
            onInput={setDraft}
            onSubmit={submit}
            onClear={() => {
              setDraft('');
              setParams({ q: undefined, filter: undefined }, { replace: true });
            }}
          />
          <button
            type="button"
            class="absolute right-(--body-gutter) grid h-10 place-items-center rounded-pill bg-white/[0.1] px-4 type-callout-emphasized text-primary transition-colors hover:bg-white/[0.18] max-sm:px-3"
            aria-label="Close search"
            onClick={leave}
          >
            Close
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-32" data-search-scroll>
          <div class="mx-auto w-full max-w-[760px] px-(--body-gutter)">
            <Show when={view() === 'recents'}><Recents /></Show>
            <Show when={view() === 'suggest'}><Suggest /></Show>
            <Show when={view() === 'results'}><Results /></Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
