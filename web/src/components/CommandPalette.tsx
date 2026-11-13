/* CommandPalette.tsx — the ⌘K quick-actions panel. */

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  ExternalLink,
  Key,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-solid';
import { A, useNavigate } from '@solidjs/router';
import { playerStore } from '@/store/player';
import { uiStore } from '@/store/ui';
import { artModeStore } from '@/store/artMode';
import { albumVideoStore } from '@/store/albumVideo';
import { preloadRoute } from '@/pageRegistry';

/** A quick action, with the state it reads as a function so it stays live. */
interface Action {
  label: () => string;
  keywords: () => string[];
  icon: () => JSX.Element;
  perform: () => void;
  when: () => boolean;
  /** A route to open instead of performing an action. */
  href?: string;
}

/** Every keyword character must appear, in order, in the query. */
function score(action: Action, query: string): number {
  const keywords = action.keywords();
  let best = 0;
  for (const keyword of keywords) {
    let i = 0;
    for (const character of query.toLowerCase()) {
      if (character === keyword[i]) i++;
      if (i === keyword.length) break;
    }
    if (i === keyword.length) return keyword.length;
    best = Math.max(best, i);
  }
  return best;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);

  const actions = createMemo<Action[]>(() => [
    {
      label: () => 'Search',
      keywords: () => ['search', 'find'],
      icon: () => <Search size={16} />,
      perform: () => {
        if (location.pathname !== '/search') navigate('/search');
        requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('global-search')?.focus()));
      },
      when: () => true,
    },
    {
      label: () => 'Settings',
      keywords: () => ['settings', 'prefs', 'preferences'],
      icon: () => <Settings size={16} />,
      perform: () => window.dispatchEvent(new CustomEvent('mc:palette')),
      when: () => true,
    },
    {
      label: () => 'Browse',
      keywords: () => ['browse', 'genres', 'charts'],
      icon: () => <ChevronRight size={16} />,
      perform: () => {},
      href: '/browse',
      when: () => true,
    },
    {
      label: () => 'Favorites',
      keywords: () => ['favorites', 'liked', 'songs'],
      icon: () => <Sparkles size={16} />,
      perform: () => {},
      href: '/favorites',
      when: () => true,
    },
    {
      label: () => 'Up Next',
      keywords: () => ['queue', 'up next'],
      icon: () => <ChevronDown size={16} />,
      perform: () => {},
      href: '/queue',
      when: () => true,
    },
    {
      label: () => (playerStore.playing ? 'Pause' : 'Play'),
      keywords: () => ['play', 'pause', 'space'],
      icon: () => (playerStore.playing ? <X size={16} /> : <Check size={16} />),
      perform: () => playerStore.toggle(),
      when: () => !!playerStore.current,
    },
    {
      label: () => 'Next track',
      keywords: () => ['next', 'skip'],
      icon: () => <ChevronRight size={16} />,
      perform: () => playerStore.next(false),
      when: () => !!playerStore.current,
    },
    {
      label: () => (uiStore.sidebarHidden ? 'Show sidebar' : 'Hide sidebar'),
      keywords: () => ['sidebar', 'menu', 'nav'],
      icon: () => <Key size={16} />,
      perform: () => uiStore.toggleSidebar(),
      when: () => true,
    },
    {
      label: () => (playerStore.fullscreen ? 'Exit full screen' : 'Enter full screen'),
      keywords: () => ['fullscreen', 'full', 'screen'],
      icon: () => <ExternalLink size={16} />,
      perform: () => playerStore.setFullscreen(!playerStore.fullscreen),
      when: () => !!playerStore.current,
    },
    {
      label: () => `Art mode: ${artModeStore.mode}`,
      keywords: () => ['art', 'mode', 'artwork', 'visual'],
      icon: () => <Sparkles size={16} />,
      perform: () => artModeStore.cycle(),
      when: () => !!playerStore.current,
    },
    {
      label: () => (albumVideoStore.on ? 'Disable album videos' : 'Enable album videos'),
      keywords: () => ['video', 'mv', 'album'],
      icon: () => <ExternalLink size={16} />,
      perform: () => albumVideoStore.toggle(),
      when: () => !!playerStore.current,
    },
    {
      label: () => 'Clear queue',
      keywords: () => ['clear', 'queue', 'empty'],
      icon: () => <Trash2 size={16} />,
      perform: () => playerStore.clearQueue(),
      when: () => playerStore.queue.length > 0,
    },
    {
      label: () => 'Copy the share link',
      keywords: () => ['copy', 'link', 'share'],
      icon: () => <Copy size={16} />,
      perform: () => {
        const id = playerStore.current?.id;
        if (!id) return;
        const url = `${location.origin}/t/${id}`;
        void navigator.clipboard?.writeText(url);
        playerStore.showToast('Link copied');
      },
      when: () => !!playerStore.current?.id,
    },
  ]);

  const items = createMemo(() => {
    const q = query().toLowerCase().trim();
    return actions()
      .filter((action) => action.when())
      .map((action) => ({ action, score: q ? score(action, q) : 1 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.action);
  });

  const close = () => {
    setOpen(false);
    setQuery('');
    setSelected(0);
  };

  const choose = (action: Action) => {
    if (action.href) {
      preloadRoute(action.href);
      close();
      navigate(action.href);
      return;
    }
    action.perform();
    close();
  };

  createEffect(() => {
    if (!open()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((value) => Math.min(value + 1, items().length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((value) => Math.max(value - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const action = items()[selected()];
        if (action) choose(action);
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        if (!open()) {
          setQuery('');
          setSelected(0);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <Show when={open()}>
      <div class="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="command-palette-backdrop" onClick={close} />
        <div class="command-palette-window">
          <div class="command-palette-header">
            <Command size={18} class="text-secondary" />
            <input
              class="command-palette-input"
              placeholder="Type a command…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              aria-label="Command palette"
            />
            <kbd class="command-palette-hint">⌘K</kbd>
          </div>
          <div class="command-palette-list">
            <Show
              when={items().length > 0}
              fallback={<div class="command-palette-empty">No matching commands</div>}
            >
              <For each={items()}>
                {(action, index) => (
                  <div
                    class={`command-palette-item ${index() === selected() ? 'selected' : ''}`}
                    onMouseEnter={() => setSelected(index())}
                    onClick={() => choose(action)}
                  >
                    <span class="command-palette-icon">{action.icon()}</span>
                    <Show
                      when={action.href}
                      fallback={<span class="command-palette-label">{action.label()}</span>}
                    >
                      <A
                        href={action.href!}
                        class="command-palette-label"
                        onClick={(event) => {
                          event.preventDefault();
                          choose(action);
                        }}
                      >
                        {action.label()}
                      </A>
                    </Show>
                    <span class="command-palette-keywords">{action.keywords().join(', ')}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
