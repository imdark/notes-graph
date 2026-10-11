import { Component as IndexComponent } from '@notesgraph/core/desktop/pages/index';
import { Navigate, useSearchParams } from 'react-router-dom';

import { AppFallback } from '../components/app-fallback';
import { readLastMobileLocation } from './last-location';

// Default route fallback for mobile

export const Component = () => {
  const [searchParams] = useSearchParams();
  // An installed PWA that the OS evicted in the background relaunches at
  // start_url (`/?source=pwa`), which would drop the user on Home every time.
  // Put them back where they were instead.
  const restore =
    searchParams.get('source') === 'pwa' ? readLastMobileLocation() : null;
  if (restore) {
    return <Navigate to={restore} replace />;
  }
  // TODO: replace with a mobile version
  return (
    <IndexComponent defaultIndexRoute={'home'} fallback={<AppFallback />} />
  );
};
