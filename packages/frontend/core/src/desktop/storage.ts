import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import {
  CacheStorage,
  GlobalCache,
  GlobalState,
} from '@notesgraph/core/modules/storage';
import {
  ElectronGlobalCache,
  ElectronGlobalState,
} from '@notesgraph/core/modules/storage/impls/electron';
import { IDBGlobalState } from '@notesgraph/core/modules/storage/impls/storage';
import type { Framework } from '@notesgraph/infra';

export function configureElectronStateStorageImpls(framework: Framework) {
  framework.impl(GlobalCache, ElectronGlobalCache, [DesktopApiService]);
  framework.impl(GlobalState, ElectronGlobalState, [DesktopApiService]);
  framework.impl(CacheStorage, IDBGlobalState);
}
