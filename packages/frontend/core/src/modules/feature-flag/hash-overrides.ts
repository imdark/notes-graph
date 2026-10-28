const HASH_KEY = 'ng-flags';

/**
 * Reads flag overrides from a URL hash such as `#ng-flags=enable_foo,-enable_bar`.
 * A bare name turns the flag on, a `-` prefix turns it off. Unknown names are dropped.
 */
export function parseFlagHashOverrides(
  hash: string,
  knownFlags: readonly string[]
): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = params.get(HASH_KEY);
  if (!raw) return overrides;
  for (const token of raw.split(',')) {
    const name = token.trim();
    if (!name) continue;
    const enabled = !name.startsWith('-');
    const key = enabled ? name : name.slice(1);
    if (knownFlags.includes(key)) {
      overrides[key] = enabled;
    }
  }
  return overrides;
}
