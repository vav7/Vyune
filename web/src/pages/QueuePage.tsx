/* QueuePage.tsx — the whole Up Next as a page (the side panel's list, wide). */

import { createMemo, Show } from 'solid-js';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/music/States';
import { playerStore } from '@/store/player';
import { UpNext } from '@/shell/UpNext';

export default function QueuePage() {
  const queue = createMemo(() => playerStore.queue);
  return (
    <>
      <PageHeader title="Queue" />
      <Show when={queue().length === 0} fallback={<div class="mx-(--body-gutter) mt-2 flex max-w-[668px] flex-col"><UpNext embedded /></div>}>
        <EmptyState title="Nothing in Up Next" detail="Songs you play appear here." />
      </Show>
    </>
  );
}