import { For } from 'solid-js';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';

const skeletonRow =
  'relative grid items-center border-y-2 border-transparent bg-card/60 bg-clip-padding [box-shadow:inset_0_0_0_0.5px_var(--cardStroke)]';

/** Album and playlist pages: artwork header, then the track list. */
export function DetailSkeleton({ rows = 8, rowArtwork = false, header = true }: { rows?: number; rowArtwork?: boolean; header?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading" class="transition-opacity duration-200">
      {header && <div
        class="mx-(--body-gutter) mb-10 grid grid-cols-[auto_1fr] items-end gap-x-[34px] pt-[52px] max-sm:grid-cols-[1fr] max-sm:justify-items-center max-sm:gap-y-4 max-sm:pt-4"
        aria-hidden="true"
      >
        <SkeletonBlock class="w-[270px] max-lg:w-[220px] max-sm:w-[min(270px,70vw)]" aspectRatio="1" radius="var(--radius-artwork-large)" />
        <div class="flex flex-col pb-1 max-sm:items-center">
          <SkeletonLine lineHeight={32} fontSize={26} width={260} />
          <SkeletonLine lineHeight={32} fontSize={26} width={180} />
          <SkeletonLine lineHeight={15} fontSize={12} width={90} style={{ 'margin-top': '4px' }} />
          <SkeletonLine lineHeight={18} fontSize={13} width="min(440px, 100%)" style={{ 'margin-top': '38px' }} />
          <SkeletonLine lineHeight={18} fontSize={13} width="min(380px, 90%)" />
          <div class="mt-3.5 flex gap-3">
            <SkeletonBlock width={100} height={36} radius={24} />
            <SkeletonBlock width={100} height={36} radius={24} />
          </div>
        </div>
      </div>}
      <div class="mx-(--body-gutter) flex flex-col" aria-hidden="true">
        <For each={Array.from({ length: rows }, (_, i) => i)}>
          {(i) => (
            <div
              class={`${skeletonRow} ${
                rowArtwork
                  ? 'h-[54px] rounded-[10px] grid-cols-[56px_minmax(0,1fr)_auto] px-1'
                  : 'h-[46px] rounded-row grid-cols-[40px_minmax(0,1fr)_auto] px-1'
              }`}
            >
              {rowArtwork ? (
                <div class="ms-[7px]">
                  <SkeletonBlock width={40} height={40} radius="var(--radius-artwork-small)" />
                </div>
              ) : (
                <div class="grid place-items-center">
                  <SkeletonLine lineHeight={16} fontSize={13} width={12} />
                </div>
              )}
              <div class="flex flex-col gap-1 min-w-0 ps-3 pe-4">
                <SkeletonLine lineHeight={16} fontSize={13} width={`${32 + ((i * 37) % 35)}%`} />
                {rowArtwork && <SkeletonLine lineHeight={14} fontSize={11} width={`${20 + ((i * 23) % 20)}%`} />}
              </div>
              <SkeletonLine lineHeight={16} fontSize={13} width={30} style={{ 'margin-right': '14px' }} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
