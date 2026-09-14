import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import { useServiceOptional } from '@notesgraph/infra';
import { useCallback } from 'react';
import { redirect } from 'react-router-dom';

import { appConfigStorage } from '../../../components/hooks/use-app-config-storage';
import { Onboarding } from '../../../components/notesgraph/onboarding/onboarding';

/**
 * /onboarding page
 *
 * only for electron
 */
export const loader = () => {
  if (!BUILD_CONFIG.isElectron && !appConfigStorage.get('onBoarding')) {
    // onboarding is off, redirect to index
    return redirect('/');
  }

  return null;
};

export const Component = () => {
  const desktopApi = useServiceOptional(DesktopApiService);

  const openApp = useCallback(() => {
    desktopApi?.handler.ui.handleOpenMainApp().catch(err => {
      console.log('failed to open main app', err);
    });
  }, [desktopApi]);

  return <Onboarding onOpenApp={openApp} />;
};
