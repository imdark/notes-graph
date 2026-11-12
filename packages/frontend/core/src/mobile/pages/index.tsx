import { Component as IndexComponent } from '@notesgraph/core/desktop/pages/index';

import { AppFallback } from '../components/app-fallback';

// Default route fallback for mobile

export const Component = () => {
  // Opened from the Capture launcher: go straight to capture rather than
  // loading the home page's notes first. Native sets this on launch.
  const launchedForCapture = !!(
    window as { notesgraphLaunchTarget?: { capture?: boolean } }
  ).notesgraphLaunchTarget?.capture;
  // TODO: replace with a mobile version
  return (
    <IndexComponent
      defaultIndexRoute={launchedForCapture ? 'capture' : 'home'}
      fallback={<AppFallback />}
    />
  );
};
