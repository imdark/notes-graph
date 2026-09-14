import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

// eruda mutates global state, so guard against double-init across remounts.
let erudaInitialized = false;

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
