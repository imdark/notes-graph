import { OnEvent, Service } from '@notesgraph/infra';
import { distinctUntilChanged, skip } from 'rxjs';

import { ApplicationStarted } from '../../lifecycle';
import { NOTESGRAPH_FLAGS } from '../constant';
import { Flags, type FlagsExt } from '../entities/flags';
import { parseFlagHashOverrides } from '../hash-overrides';

@OnEvent(ApplicationStarted, e => e.setupRestartListener)
export class FeatureFlagService extends Service {
  flags = this.framework.createEntity(Flags) as FlagsExt;

  applyHashOverrides() {
    const overrides = parseFlagHashOverrides(
      window.location.hash,
      Object.keys(NOTESGRAPH_FLAGS)
    );
    for (const [key, value] of Object.entries(overrides)) {
      (this.flags as unknown as Record<string, { set(v: boolean): void }>)[
        key
      ].set(value);
    }
  }

  setupRestartListener() {
    this.applyHashOverrides();
    this.flags.enable_ai.$.pipe(distinctUntilChanged(), skip(1)).subscribe(
      () => {
        // when enable_ai flag changes, reload the page.
        window.location.reload();
      }
    );
  }
}
