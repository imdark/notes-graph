import type { Framework } from '@notesgraph/infra';

import { AppLockProvider } from './providers/app-lock';
import { AppLockService } from './services/app-lock';

export { AppLockProvider, type AppLockState } from './providers/app-lock';
export { AppLockService } from './services/app-lock';

export const configureAppLockModule = (framework: Framework) => {
  framework.service(AppLockService, container => {
    return new AppLockService(container.getOptional(AppLockProvider));
  });
};
