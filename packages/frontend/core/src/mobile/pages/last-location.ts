const KEY = 'ng-mobile-last-location';

export function saveLastMobileLocation(path: string) {
  try {
    localStorage.setItem(KEY, path);
  } catch {
    // storage unavailable — restoring is best-effort
  }
}

export function readLastMobileLocation(): string | null {
  try {
    const path = localStorage.getItem(KEY);
    return path?.startsWith('/workspace/') ? path : null;
  } catch {
    return null;
  }
}
