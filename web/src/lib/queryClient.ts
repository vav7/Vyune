import { QueryClient } from '@tanstack/solid-query';

/** The app's one query client, shared by the tree and the route prefetcher. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 60_000,
    },
  },
});

// A lightweight global cache view for components that need read-only access
// without a full query subscription (the lyric marquee in the compact player).
if (typeof window !== 'undefined') {
  (window as unknown as { __QUERY_CACHE__: unknown }).__QUERY_CACHE__ = queryClient.getQueryCache();
}
