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
  const sections = createMemo(() => query.data?.sections?.length ? query.data!.sections : [{ title: 'Featured playlists', items: items() }]);
  const featured = createMemo(() => sections().filter((section) => !/community|user.?made/i.test(section.title)));
  const community = createMemo(() => sections().filter((section) => /community|user.?made/i.test(section.title)));
  const title = createMemo(() => decodeURIComponent(label()));

  const renderSection = (section: { title: string; items: Card[] }, sectionKey: string, initialCount: number) => {
    const isExpanded = () => !!expanded()[sectionKey];
    const visibleItems = () => (isExpanded() ? section.items : section.items.slice(0, initialCount));
    return (
      <section class="pt-7" aria-label={section.title}>
        <div class="mx-(--body-gutter) mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 class="type-title-2-emphasized">{section.title}</h2>
            <p class="mt-0.5 type-caption-1 text-secondary">{section.items.length} playlists, with duplicates removed</p>
          </div>
        </div>
        <ul class={seeAllGrid}>
          <For each={visibleItems()}>
            {(item) => (
              <li class="animate-fade-in">
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
        <>
          <For each={featured()}>
            {(section, i) => <>{renderSection(section, `featured-${i()}`, 24)}</>}
          </For>
          <Show when={community().length > 0}>
            <details class="mx-(--body-gutter) mt-8 mb-10 overflow-hidden rounded-[20px] border border-white/10 bg-thin-material px-4 open:pb-5 sm:px-5">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                <span>
                  <span class="block type-title-3-emphasized">Community playlists</span>
                  <span class="mt-0.5 block type-caption-1 text-secondary">Listener-made picks, kept in their own collection</span>
                </span>
                <span class="rounded-full bg-white/8 px-3 py-1 type-caption-1 text-secondary">
                  {community().reduce((sum, section) => sum + section.items.length, 0)}
                </span>
              </summary>
              <For each={community()}>
                {(section, i) => <>{renderSection(section, `community-${i()}`, 12)}</>}
              </For>
            </details>
          </Show>
        </>
      </Show>
    </>
  );
}
