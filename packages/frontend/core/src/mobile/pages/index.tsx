import { Component as IndexComponent } from '@notesgraph/core/desktop/pages/index';

import { AppFallback } from '../components/app-fallback';

// Default route fallback for mobile

// The Android "NotesGraph Capture" icon exposes `NGLaunch` on a cold start so
// the first page is capture, not the last note.
const launchedForCapture = () =>
  !!(
    window as unknown as { NGLaunch?: { isCapture?: () => boolean } }
  ).NGLaunch?.isCapture?.();

export const Component = () => {
  // TODO: replace with a mobile version
  return (
    <IndexComponent
      defaultIndexRoute={launchedForCapture() ? 'capture' : 'home'}
      fallback={<AppFallback />}
    />
  );
};
