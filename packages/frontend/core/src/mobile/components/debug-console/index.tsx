import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

// eruda mutates global state, so guard against double-init across remounts.
let erudaInitialized = false;

// eruda's entry button is 40px; the mobile page header is 44px tall.
const ENTRY_BUTTON_SIZE = 40;
const HEADER_HEIGHT = 44;
const EDGE_GAP = 8;

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
        // Top right, under the status bar and app header, instead of eruda's
        // bottom-right default where it sits on the tab bar.
        eruda.position({
          x: window.innerWidth - ENTRY_BUTTON_SIZE - EDGE_GAP,
          y: safeAreaTop() + HEADER_HEIGHT + EDGE_GAP,
        });
      })
      .catch(err => {
        console.error('Failed to load debug console', err);
      });

    return () => {
      disposed = true;
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
