import { StoreExtensionManager } from '@blocksuite/notesgraph/ext-loader';
import { getInternalStoreExtensions } from '@blocksuite/notesgraph/extensions/store';
import { AIStoreExtension } from '@notesgraph/core/blocksuite/store-extensions/ai';
import type { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';

import { FeatureFlagStoreExtension } from '../store-extensions/feature-flag';
import { LinkCardStoreExtension } from '../store-extensions/link-card';

interface Configure {
  init: () => Configure;

  featureFlag: (featureFlagService?: FeatureFlagService) => Configure;

  value: StoreExtensionManager;
}

class StoreProvider {
  static instance: StoreProvider | null = null;
  static getInstance() {
    if (!StoreProvider.instance) {
      StoreProvider.instance = new StoreProvider();
    }
    return StoreProvider.instance;
  }

  private readonly _manager: StoreExtensionManager;

  constructor() {
    this._manager = new StoreExtensionManager([
      ...getInternalStoreExtensions(),
      AIStoreExtension,
      FeatureFlagStoreExtension,
      LinkCardStoreExtension,
    ]);
  }

  get config(): Configure {
    return {
      init: this._initDefaultConfig,
      featureFlag: this._configureFeatureFlag,
      value: this._manager,
    };
  }

  get value(): StoreExtensionManager {
    return this._manager;
  }

  private readonly _initDefaultConfig = () => {
    this.config.featureFlag();

    return this.config;
  };

  private readonly _configureFeatureFlag = (
    featureFlagService?: FeatureFlagService
  ) => {
    this._manager.configure(FeatureFlagStoreExtension, { featureFlagService });
    return this.config;
  };
}

export function getStoreManager() {
  return StoreProvider.getInstance();
}
