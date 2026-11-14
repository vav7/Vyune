import { For, type JSX } from 'solid-js';
import { SidebarPlayer } from './SidebarPlayer';
import { ListMusic, Settings, Star } from 'lucide-solid';
import { LogoMark } from '@/components/LogoMark';
import { PrefetchLink, PrefetchNavLink } from '@/components/PrefetchLink';
import {
  HomeIcon,
  NewIcon,
  SearchIcon,
  type NavIconProps,
} from '@/components/icons/NavIcons';
import { uiStore } from '@/store/ui';

interface NavItem {
  to: string;
  label: string;
  Icon: (props: NavIconProps) => JSX.Element;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/browse', label: 'Browse', Icon: NewIcon },
];

const LIBRARY: NavItem[] = [
  { to: '/favorites', label: 'Favorite Songs', Icon: StarNav },
  { to: '/queue', label: 'Up Next', Icon: QueueNav },
];

function StarNav(props: NavIconProps) {
  return <Star {...size24(props)} strokeWidth={1.7} />;
}
function QueueNav(props: NavIconProps) {
  return <ListMusic {...size24(props)} strokeWidth={1.7} />;
}
function size24({ size: _size, ...props }: NavIconProps) {
  return { size: 19, ...props, class: `m-[2.5px] ${props.class ?? ''}` };
}

// A sidebar row; NavLink sets aria-current on the page's own row.
const item =
  'group relative flex h-10 items-center gap-3 mb-1 px-3 rounded-[10px] type-[600_14px/20px] tracking-[-0.01em] text-white/75 transition-[background-color,color] duration-150 ease-out hover:bg-white/[0.09] hover:text-white aria-[current=page]:bg-white/[0.18] aria-[current=page]:text-white aria-[current=page]:shadow-[inset_0_1px_0_#ffffff45,inset_0_0_0_0.5px_#ffffff20,0_4px_14px_-6px_#0008]';
// Apple's glyphs, drawn at 24px (their 24-unit box).
const icon = 'inline-grid size-6 flex-none place-items-center text-current transition-colors group-aria-[current=page]:text-key';
const navLabel = 'min-w-0 truncate';
// "Library" (report §1: 12px/15px 600, secondary, padding 4px 8px).
const sectionHeader = 'mt-5 px-2 py-1 type-[700_11px/14px] tracking-[0.12em] text-tertiary uppercase';
const list = 'flex flex-col';

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <ul class={list}>
      <For each={items}>
        {({ to, label, Icon, end }) => (
          <li>
            <PrefetchNavLink to={to} end={end} class={item} onClick={onNavigate}>
              <Icon size={24} class={icon} />
              <span class={navLabel}>{label}</span>
            </PrefetchNavLink>
          </li>
        )}
      </For>
    </ul>
  );
}

/** The left glass sidebar (report §1). */
export function Sidebar() {
  const drawerOpen = uiStore.drawerOpen;
  const setDrawerOpen = uiStore.setDrawerOpen;
  const close = () => setDrawerOpen(false);

  return (
    <>
      {/* Below 484px the sidebar is a drawer opened from the top bar's menu button. */}
      <nav
        class="sidebar-glass absolute top-1 bottom-1 left-1 z-(--z-web-chrome) flex w-[calc(var(--web-navigation-width)-8px)] flex-col overflow-hidden rounded-[14px] max-sm:inset-y-0 max-sm:left-0 max-sm:w-[min(300px,82vw)] max-sm:-translate-x-full max-sm:rounded-none max-sm:rounded-r-[14px] max-sm:transition-transform max-sm:duration-(--duration-panel) max-sm:ease-panel max-sm:data-[open=true]:translate-none"
        data-open={drawerOpen}
        aria-label="Main"
        data-sidebar
      >
        <div class="mt-2 flex h-18 items-center px-6">
          <PrefetchLink to="/" class="group inline-flex items-center gap-2.5 rounded-[6px]" aria-label="VYUNE, Home" onClick={close}>
            <span class="brand-glass grid size-11 shrink-0 place-items-center rounded-[12px] transition-transform duration-300 group-hover:scale-[1.04]"><LogoMark size={26} /></span>
            <span class="flex min-w-0 flex-col">
              <span class="type-[650_18px/22px] tracking-[0.2em]">VYUNE</span>
              <span class="mt-0.5 whitespace-nowrap type-[500_7px/9px] tracking-[0.25em] text-secondary">FEEL EVERY FREQUENCY</span>
            </span>
          </PrefetchLink>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 [scrollbar-width:none]">
          <NavList items={PRIMARY} onNavigate={close} />
          <h2 class={sectionHeader}>Library</h2>
          <NavList items={LIBRARY} onNavigate={close} />
        </div>
        <SidebarPlayer />
        <div class="flex flex-col gap-2 px-3 pt-3 pb-4">
          <button
            class={item}
            onClick={() => {
              close();
              window.dispatchEvent(new CustomEvent('mc:palette'));
            }}
          >
            <span class={icon}>
              <Settings size={18} strokeWidth={1.8} />
            </span>
            <span class={navLabel}>Quick Actions</span>
            <span class="ml-auto rounded-[6px] bg-quinary px-1.5 py-0.5 type-caption-2 text-secondary">⌘K</span>
          </button>
        </div>
      </nav>
      {drawerOpen && (
        <div class="absolute inset-0 z-[calc(var(--z-web-chrome)-1)] hidden bg-scrim max-sm:block" onClick={close} aria-hidden="true" />
      )}
    </>
  );
}
