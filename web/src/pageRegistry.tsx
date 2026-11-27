import { lazy, Suspense, type Component } from 'solid-js';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { matchPath } from '@/lib/matchPath';
import HomePage from '@/pages/HomePage';
import PlaylistPage from '@/pages/PlaylistPage';
import AlbumPage from '@/pages/AlbumPage';
import SearchPage from '@/pages/SearchPage';
import BrowsePage from '@/pages/BrowsePage';
import ArtistPage from '@/pages/ArtistPage';

type PageModule = { default: Component<Record<string, never>> };

export interface PageRoute {
  path: string;
  load: () => Promise<PageModule>;
  /** The route component, built ONCE at module scope. */
  component: Component<Record<string, never>>;
}

interface PageDefinition {
  path: string;
  load: () => Promise<PageModule>;
  component?: Component<Record<string, never>>;
}

/**
 * Core pages (Home, Playlist, Album) are mounted directly for instant, zero-delay
 * frame-1 transitions with no black screens or chunk-loading suspense.
 * Heavy secondary pages (Search, Artist, Browse) load cleanly without flashing skeletons.
 */
const definitions: PageDefinition[] = [
  {
    path: '/',
    load: () => Promise.resolve({ default: HomePage }),
    component: HomePage,
  },
  { path: '/search', load: () => Promise.resolve({ default: SearchPage }), component: SearchPage },
  { path: '/browse', load: () => Promise.resolve({ default: BrowsePage }), component: BrowsePage },
  {
    path: '/genre/:params/:label',
    load: () => import('@/pages/GenrePage') as Promise<PageModule>,
  },
  {
    path: '/album/:id',
    load: () => Promise.resolve({ default: AlbumPage }),
    component: AlbumPage,
  },
  { path: '/artist/:id', load: () => Promise.resolve({ default: ArtistPage }), component: ArtistPage },
  {
    path: '/playlist/:id',
    load: () => Promise.resolve({ default: PlaylistPage }),
    component: PlaylistPage,
  },
  { path: '/queue', load: () => import('@/pages/QueuePage') as Promise<PageModule> },
  {
    path: '/favorites',
    load: () => import('@/pages/FavoritesPage') as Promise<PageModule>,
  },
  {
    path: '/t/:id',
    load: () => import('@/pages/TrackSharePage') as Promise<PageModule>,
  },
];

/**
 * The route component, built ONCE at module scope: direct components mount on frame 1;
 * lazy components use Suspense only while their secondary bundle arrives with no flashing skeletons.
 */
function routeComponent(def: PageDefinition): Component<Record<string, never>> {
  if (def.component) return def.component;
  const Page = lazy(def.load);
  return function PageRoute() {
    return (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    );
  };
}

export const pages: PageRoute[] = definitions.map((definition) => ({
  ...definition,
  component: routeComponent(definition),
}));

/** Warm the first query behind an href, so the page opens on data. Safe to call repeatedly. */
function prefetchPageData(href: string): void {
  const url = new URL(href, 'http://localhost');
  const pathname = url.pathname;
  const warm = (key: unknown[], fn: () => Promise<unknown>) => {
    void queryClient.prefetchQuery({ queryKey: key, queryFn: fn, staleTime: 60_000 }).catch(() => {});
  };
  const pl = matchPath('/playlist/:id', pathname);
  if (pl) return warm(['playlist', pl.params.id], () => api.playlist(String(pl.params.id)));
  const al = matchPath('/album/:id', pathname);
  if (al) return warm(['album', al.params.id], () => api.album(String(al.params.id)));
  const ar = matchPath('/artist/:id', pathname);
  if (ar) return warm(['artist', ar.params.id], () => api.artist(String(ar.params.id)));
  const ge = matchPath('/genre/:params/:label', pathname);
  if (ge) return warm(['genre-playlists', ge.params.params], () => api.genrePlaylists(String(ge.params.params)));
  if (pathname === '/search') {
    const q = url.searchParams.get('q');
    const f = url.searchParams.get('filter') || 'all';
    if (q) return warm(['search-page', f, q.trim()], () => api.searchPage(q.trim(), f as 'all'));
  }
  if (pathname === '/browse') {
    warm(['charts'], () => api.charts());
    warm(['genres'], () => api.genres());
  }
}

/** Warms the chunk, and the first query, for whatever page `href` leads to. */
export function preloadRoute(href: string): void {
  const pathname = href.split(/[?#]/)[0] ?? href;
  const page = pages.find((p) => matchPath(p.path, pathname) || (p.path === '/' && pathname === '/'));
  void page?.load().catch(() => {
    // A failed prefetch is retried by the real navigation.
  });
  prefetchPageData(href);
}
