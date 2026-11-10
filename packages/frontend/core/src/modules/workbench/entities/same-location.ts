import { type Location, parsePath, type To } from 'history';

/**
 * Whether navigating to `to` from `current` would land on the same URL.
 * Fills in missing parts the way `history` does on push: pathname from
 * `current`, search and hash empty.
 */
export function isSameLocation(current: Location, to: To): boolean {
  const next = {
    pathname: current.pathname,
    search: '',
    hash: '',
    ...(typeof to === 'string' ? parsePath(to) : to),
  };
  return (
    next.pathname === current.pathname &&
    normalize(next.search, '?') === normalize(current.search, '?') &&
    normalize(next.hash, '#') === normalize(current.hash, '#')
  );
}

function normalize(part: string | undefined, prefix: string) {
  if (!part || part === prefix) return '';
  return part.startsWith(prefix) ? part : prefix + part;
}
