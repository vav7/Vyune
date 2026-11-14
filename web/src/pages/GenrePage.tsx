/* GenrePage.tsx — the official playlists inside one moods & genres category,
 * as a See All grid (report §2). */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { PageHeader } from '@/components/PageHeader';
import { SquareLockup } from '@/components/music/Lockups';
import { EmptyState, LoadError } from '@/components/music/States';
import { cardItem } from '@/components/music/types';
import { api } from '@/lib/api';
import type { Card } from '@/lib/types';
import { seeAllGrid } from '@/pages/pageStyles';

export default function GenrePage() {
  const params = useParams();
  const p = () => params.params ?? '';
  const label = () => params.label ?? '';

  const query = useQuery(() => ({
    queryKey: ['genre-playlists', p()],
    queryFn: () => api.genrePlaylists(decodeURIComponent(p())),
    staleTime: 12 * 3600_000,
  }));

  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const items = createMemo(() => query.data?.items || []);
  const sections = createMemo(() => {
    const s = query.data?.sections || [];
    // Keep only official curated sections; drop user/community generated scrap
    const clean = s.filter((sec) => !/community|user.?made/i.test(sec.title));
    return clean.length ? clean : [{ title: 'Featured Playlists', items: items() }];
  });
  const title = createMemo(() => decodeURIComponent(label()));

  const renderSection = (section: { title: string; items: Card[] }, sectionKey: string, initialCount: number) => {
    const isExpanded = () => !!expanded()[sectionKey];
    const visibleItems = () => (isExpanded() ? section.items : section.items.slice(0, initialCount));
    return (
      <section class="pt-7" aria-label={section.title}>
        <div class="mx-(--body-gutter) mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 class="type-title-2-emphasized">{section.title}</h2>
            <p class="mt-0.5 type-caption-1 text-secondary">{section.items.length} official playlists</p>
          </div>
        </div>
        <ul class={seeAllGrid}>
          <For each={visibleItems()}>
            {(item) => (
              <li class="animate-fade-in [content-visibility:auto] [contain-intrinsic-size:auto_220px]">
                <SquareLockup item={cardItem(item)} />
              </li>
            )}
          </For>
        </ul>
        <Show when={section.items.length > initialCount}>
          <div class="mx-(--body-gutter) mt-2 flex justify-center">
            <button
              class="rounded-full border border-white/10 bg-thin-material px-5 py-2 type-callout-emphasized text-secondary transition-[background-color,color,scale] duration-200 hover:bg-quinary hover:text-primary active:scale-[.98]"
              aria-expanded={isExpanded()}
              onClick={() => setExpanded((value) => ({ ...value, [sectionKey]: !value[sectionKey] }))}
            >
              {isExpanded() ? 'Show fewer' : `Show all ${section.items.length}`}
            </button>
          </div>
        </Show>
      </section>
    );
  };

  return (
    <>
      <PageHeader title={title()} />
      <p class="mx-(--body-gutter) mt-1 mb-4 type-callout text-secondary">
        {query.isPending ? 'Loading…' : `${items().length} official YouTube Music playlists`}
      </p>
      <Show when={query.isError}><LoadError error={query.error} onRetry={() => void query.refetch()} /></Show>
      <Show when={!query.isPending && !query.isError && items().length === 0}><EmptyState title="Nothing here yet" detail="YouTube returned no playlists." /></Show>
      <Show when={items().length > 0}>
        <For each={sections()}>
          {(section, i) => <>{renderSection(section, `section-${i()}`, 24)}</>}
        </For>
      </Show>
    </>
  );
}
