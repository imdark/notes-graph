import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

// eruda mutates global state, so guard against double-init across remounts.
let erudaInitialized = false;

// eruda's entry button is 40px; the mobile page header is 44px tall.
const ENTRY_BUTTON_SIZE = 40;
const HEADER_HEIGHT = 44;
const MAX_LOG_ROWS = 500;

const MAX_ERROR_ENTRIES = 200;
const errorEntries: string[] = [];
let errorCaptureInstalled = false;

const stringify = (value: unknown) =>
  value instanceof Error
    ? (value.stack ?? value.message)
    : typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();

function pushError(text: string) {
  errorEntries.push(`[${new Date().toISOString()}] ${text}`);
  if (errorEntries.length > MAX_ERROR_ENTRIES) errorEntries.shift();
}

// Keeps a plain-text copy of console.error, uncaught errors and rejections so
// the "Errors" panel can filter and copy them; eruda's own console can't.
function installErrorCapture() {
  if (errorCaptureInstalled) return;
  errorCaptureInstalled = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    pushError(args.map(stringify).join(' '));
    original(...args);
  };
  window.addEventListener('error', e =>
    pushError(stringify(e.error ?? e.message))
  );
  window.addEventListener('unhandledrejection', e =>
    pushError(`Unhandled rejection: ${stringify(e.reason)}`)
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function createErrorsTool(eruda: {
  Tool: new () => any;
}) {
  const tool = new eruda.Tool();
  let box: HTMLElement | undefined;
  let filter = '';
  const render = () => {
    if (!box) return;
    const list = box.querySelector<HTMLElement>('.ng-errors-list');
    if (!list) return;
    const q = filter.toLowerCase();
    const rows = errorEntries.filter(e => e.toLowerCase().includes(q));
    list.textContent = rows.join('\n\n') || 'No errors';
  };
  tool.name = 'errors';
  tool.init = ($el: any) => {
    box = $el.get(0) as HTMLElement;
    box.innerHTML =
      '<div style="display:flex;gap:8px;padding:8px">' +
      '<input class="ng-errors-filter" placeholder="Filter errors" style="flex:1;min-width:0;padding:6px"/>' +
      '<button class="ng-errors-copy" style="padding:6px 12px">Copy</button>' +
      '<button class="ng-errors-clear" style="padding:6px 12px">Clear</button></div>' +
      '<pre class="ng-errors-list" style="margin:0;padding:8px;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text"></pre>';
    box
      .querySelector('.ng-errors-filter')
      ?.addEventListener('input', e => {
        filter = (e.target as HTMLInputElement).value;
        render();
      });
    box.querySelector('.ng-errors-copy')?.addEventListener('click', () => {
      const q = filter.toLowerCase();
      void copyText(
        errorEntries.filter(e => e.toLowerCase().includes(q)).join('\n\n')
      );
    });
    box.querySelector('.ng-errors-clear')?.addEventListener('click', () => {
      errorEntries.length = 0;
      render();
    });
  };
  tool.show = () => {
    render();
    return tool;
  };
  return tool;
}

function safeAreaTop() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)';
  document.body.append(probe);
  const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return top;
}

/**
 * Mounts an on-screen debug console (eruda) when the `enable_debug_console`
 * feature flag is on. Meant for iOS/Android, where native devtools aren't
 * reachable: it surfaces console logs, uncaught errors and promise rejections,
 * and a network panel for every fetch/XHR (GraphQL included). eruda is loaded
 * with a dynamic import so it never touches the bundle unless actually enabled.
 */
export const DebugConsole = () => {
  const featureFlagService = useService(FeatureFlagService);
  const enabled = useLiveData(featureFlagService.flags.enable_debug_console.$);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    let instance: { destroy: () => void } | undefined;
    let onResize: (() => void) | undefined;

    import('eruda')
      .then(({ default: eruda }) => {
        if (disposed) {
          return;
        }
        instance = eruda;
        if (!erudaInitialized) {
          installErrorCapture();
          eruda.init();
          eruda.add(createErrorsTool(eruda as any));
          erudaInitialized = true;
        }
        // eruda keeps every console row as DOM by default ("infinite"); on a
        // phone that alone grew past 1.5 GB and got the renderer killed.
        eruda.get('console')?.config.set('maxLogNum', String(MAX_LOG_ROWS));
        // Top centre, on the app name row just under the status bar, instead
        // of eruda's bottom-right default where it sits on the tab bar.
        const place = () =>
          eruda.position({
            x: (window.innerWidth - ENTRY_BUTTON_SIZE) / 2,
            y: safeAreaTop() + (HEADER_HEIGHT - ENTRY_BUTTON_SIZE) / 2,
          });
        place();
        // eruda resets the button to its bottom-right default on every window
        // resize (WebView layout settling, keyboard, rotation), which undid the
        // placement above. Re-apply after its own resize handler has run.
        onResize = () => setTimeout(place, 0);
        window.addEventListener('resize', onResize);
      })
      .catch(err => {
        console.error('Failed to load debug console', err);
      });

    return () => {
      disposed = true;
      if (onResize) {
        window.removeEventListener('resize', onResize);
      }
      if (erudaInitialized) {
        try {
          instance?.destroy();
        } catch {
          // ignore teardown errors
        }
        erudaInitialized = false;
      }
    };
  }, [enabled]);

  return null;
};
