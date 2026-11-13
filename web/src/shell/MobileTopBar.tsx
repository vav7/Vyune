import { Menu } from 'lucide-solid';
import { PrefetchLink } from '@/components/PrefetchLink';
import { LogoMark } from '@/components/LogoMark';
import { uiStore } from '@/store/ui';

/** Below 484px the sidebar folds into this bar and a drawer (report §11). */
export function MobileTopBar() {
  const setDrawerOpen = uiStore.setDrawerOpen;
  return (
    <header class="hidden max-sm:absolute max-sm:inset-x-0 max-sm:top-0 max-sm:z-[calc(var(--z-web-chrome)-2)] max-sm:grid max-sm:h-(--mobile-top-bar-height) max-sm:grid-cols-[44px_1fr_44px] max-sm:items-center max-sm:px-3.5 max-sm:glass-material">
      <button class="grid size-11 place-items-center rounded-full" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
        <Menu size={22} strokeWidth={2} />
      </button>
      <PrefetchLink to="/" class="inline-flex items-center gap-2 justify-self-center type-[650_14px/20px] tracking-[0.2em]" aria-label="VYUNE, Home">
        <LogoMark size={25} />
        <span>VYUNE</span>
      </PrefetchLink>
      <span class="w-11" />
    </header>
  );
}
