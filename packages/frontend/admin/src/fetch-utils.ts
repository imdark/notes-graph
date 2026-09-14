/**
 * Custom fetch utility with NotesGraph version header
 * Automatically adds the x-notesgraph-version header to all fetch requests
 */

// BUILD_CONFIG is defined globally in the NotesGraph project

/**
 * Wrapper around fetch that automatically adds the x-notesgraph-version header
 * @param input Request URL
 * @param init Request initialization options
 * @returns Promise with the fetch Response
 */
const CSRF_COOKIE_NAME = 'notesgraph_csrf_token';

function getCookieValue(name: string) {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const idx = cookie.indexOf('=');
    const key = idx === -1 ? cookie : cookie.slice(0, idx);
    if (key === name) {
      return idx === -1 ? '' : cookie.slice(idx + 1);
    }
  }
  return null;
}

export const notesgraphFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const csrfToken =
    method !== 'GET' && method !== 'HEAD'
      ? getCookieValue(CSRF_COOKIE_NAME)
      : null;

  return fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      'x-notesgraph-version': BUILD_CONFIG.appVersion,
      ...(csrfToken ? { 'x-notesgraph-csrf-token': csrfToken } : {}),
    },
  });
};
