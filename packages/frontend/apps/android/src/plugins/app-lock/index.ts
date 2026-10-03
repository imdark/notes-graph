import { registerPlugin } from '@capacitor/core';

import type { AppLockPlugin } from './definitions';

const AppLock = registerPlugin<AppLockPlugin>('AppLock');

export * from './definitions';
export { AppLock };
