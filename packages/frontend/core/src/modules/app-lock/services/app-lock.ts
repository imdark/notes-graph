import { LiveData, Service } from '@notesgraph/infra';

import type { AppLockProvider, AppLockState } from '../providers/app-lock';

export class AppLockService extends Service {
  constructor(private readonly provider?: AppLockProvider) {
    super();
  }

  /** null until first read, and forever on a platform with no app lock. */
  readonly state$ = new LiveData<AppLockState | null>(null);

  get supported() {
    return !!this.provider;
  }

  async revalidate() {
    if (!this.provider) return;
    this.state$.next(await this.provider.getState());
  }

  async setEnabled(enabled: boolean) {
    if (!this.provider) return;
    this.state$.next(await this.provider.setEnabled(enabled));
  }
}
