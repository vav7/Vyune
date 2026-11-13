/* TrackSharePage.tsx — /t/:videoId landing: the track's card and one-tap play. */

import { createMemo, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { A } from '@solidjs/router';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { EmptyState } from '@/components/music/States';
import { detailButton } from '@/components/music/DetailHeader';
import { formatDuration } from '@/components/music/links';
import { playTrack } from '@/components/music/play';
import type { Track } from '@/lib/types';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';

export default function TrackSharePage() {
  const params = useParams();
  const id = () => params.id ?? '';

  const query = useQuery(() => ({
    queryKey: ['track-card', id()],
    queryFn: () => fetch(`/api/track?id=${encodeURIComponent(id())}`).then((r) => (r.ok ? r.json() : null)),
    retry: false,
    enabled: !!id(),
  }));

  const track = createMemo(() => {
    if (!query.data || query.data.error) return null;
    return {
      ...query.data,
      artists: (query.data.artists || []).map((a: string) => a.replace(/\s*-\s*Topic$/i, '')),
    } as Track;
  });

  return (
    <Show when={query.isPending} fallback={
      <Show when={track()} fallback={<EmptyState title="Track not found" detail="This share link points to a video we can't resolve." />}>
      {(loadedTrack) => (
      <div class="mx-auto flex max-w-md flex-col items-center px-(--body-gutter) pt-14 text-center">
      <div class="w-[224px] shadow-[0_10px_20px_0_var(--radiosityShadowColor)]">
        <Artwork src={loadedTrack().thumb} track={loadedTrack()} displayWidth={224} radius="var(--radius-artwork-large)" eager />
      </div>
      <h1 class="mt-6 break-words type-large-title-emphasized">{loadedTrack().title}</h1>
      <p class="mt-1 type-body-tall text-secondary">
        {(loadedTrack().artists || []).join(', ')}
        {loadedTrack().duration ? ` · ${formatDuration(loadedTrack().duration)}` : ''}
      </p>
      <p class="mt-1 type-caption-2 uppercase tracking-[0.14em] text-tertiary">Shared track · VYUNE</p>
      <div class="mt-6 flex items-center justify-center gap-3.5">
        <button class={detailButton.pill} onClick={() => playTrack(loadedTrack())}>
          <PlayIcon size={18} />
          <span>Play</span>
        </button>
        <A
          href={`/search?q=${encodeURIComponent(`${loadedTrack().title} ${(loadedTrack().artists || [])[0] || ''}`)}`}
          class={detailButton.circle}
          aria-label="Find versions"
          title="Find versions"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </A>
      </div>
      </div>
      )}
      </Show>
    }>
      <div class="mx-auto flex max-w-md flex-col items-center pt-16" aria-busy="true">
        <SkeletonBlock width="224px" height="224px" radius="var(--radius-artwork-large)" />
        <SkeletonLine lineHeight={32} fontSize={26} width="220px" style={{ 'margin-top': '24px' }} />
        <SkeletonLine lineHeight={16} fontSize={13} width="140px" style={{ 'margin-top': '6px' }} />
      </div>
    </Show>
  );
}
