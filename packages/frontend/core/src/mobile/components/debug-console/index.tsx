import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

// eruda mutates global state, so guard against double-init across remounts.
let erudaInitialized = false;

// eruda's entry button is 40px; the mobile page header is 44px tall.
const ENTRY_BUTTON_SIZE = 40;
const HEADER_HEIGHT = 44;
const EDGE_GAP = 8;
const MAX_LOG_ROWS = 500;

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
          eruda.init();
          erudaInitialized = true;
        }
        // eruda keeps every console row as DOM by default ("infinite"); on a
        // phone that alone grew past 1.5 GB and got the renderer killed.
        eruda.get('console')?.config.set('maxLogNum', String(MAX_LOG_ROWS));
        // Top right, under the status bar and app header, instead of eruda's
        // bottom-right default where it sits on the tab bar.
        const place = () =>
          eruda.position({
            x: window.innerWidth - ENTRY_BUTTON_SIZE - EDGE_GAP,
            y: safeAreaTop() + HEADER_HEIGHT + EDGE_GAP,
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
