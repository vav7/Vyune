/**
 * matchPath.ts — the tiny path matcher the route prefetcher uses.
 *
 * React Router's `matchPath` is gone with React Router, and the Solid router
 * has no equivalent for "which of my route patterns does this href match?".
 * This is the same shape: a pattern with `:params`, matched against a
 * pathname, returning the captured parameters.
 */

export interface PathMatch {
  params: Record<string, string>;
  path: string;
  pathname: string;
  pattern: string;
}

export function matchPath(pattern: string, pathname: string): PathMatch | null {
  if (!pattern || !pathname) return null;

  const patternSegments = pattern.replace(/^\/+|\/+$/g, '').split('/');
  const pathSegments = pathname.replace(/^\/+|\/+$/g, '').split('/');

  const params: Record<string, string> = {};
  let patternIndex = 0;
  let pathIndex = 0;

  for (; patternIndex < patternSegments.length; patternIndex++) {
    const segment = patternSegments[patternIndex]!;

    // A trailing `*` swallows the rest of the path.
    if (segment === '*') {
      params['*'] = pathSegments.slice(pathIndex).join('/');
      return { params, path: pathname, pathname, pattern };
    }

    if (pathIndex >= pathSegments.length) return null;

    const current = pathSegments[pathIndex]!;
    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      const name = segment.slice(1, optional ? -1 : undefined);
      if (!current) {
        if (!optional) return null;
        continue;
      }
      params[name] = decodeURIComponent(current);
      pathIndex++;
      continue;
    }

    if (segment.toLowerCase() !== current.toLowerCase()) return null;
    pathIndex++;
  }

  if (pathIndex !== pathSegments.length) return null;
  return { params, path: pathname, pathname, pattern };
}
