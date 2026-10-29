import { Entity, LiveData } from '@notesgraph/infra';
import { combineLatest, map, startWith } from 'rxjs';

import type { GlobalStateService } from '../../storage';
import { NOTESGRAPH_FLAGS } from '../constant';
import type { FlagInfo } from '../types';

const FLAG_PREFIX = 'notesgraph-flag:';
/**
 * What an admin set a flag to for everyone, as the server last said (see
 * FeatureFlagService.applyAdminOverrides). Kept here so it holds from the
 * next start, before the server has answered.
 */
export const ADMIN_FLAG_PREFIX = 'notesgraph-flag-admin:';

export type Flag<F extends FlagInfo = FlagInfo> = {
  readonly value: F['defaultState'] extends boolean
    ? boolean
    : boolean | undefined;
  set: (value: boolean) => void;
  // eslint-disable-next-line rxjs/finnish
  $: F['defaultState'] extends boolean
    ? LiveData<boolean>
    : LiveData<boolean> | LiveData<boolean | undefined>;
  /** What an admin set it to for everyone; undefined when they haven't. */
  readonly adminOverride: boolean | undefined;
} & F;

export class Flags extends Entity {
  private readonly globalState = this.globalStateService.globalState;

  constructor(private readonly globalStateService: GlobalStateService) {
    super();

    Object.entries(NOTESGRAPH_FLAGS).forEach(([flagKey, flag]) => {
      const configurable = flag.configurable ?? true;
      const defaultState =
        'defaultState' in flag ? flag.defaultState : undefined;
      const adminKey = ADMIN_FLAG_PREFIX + flagKey;
      // An admin's setting wins over the user's own and the default.
      const resolve = (admin: boolean | undefined, own: boolean | undefined) =>
        admin ?? (configurable ? (own ?? defaultState) : defaultState);
      const getAdmin = () => this.globalState.get<boolean>(adminKey);
      const getOwn = () => this.globalState.get<boolean>(FLAG_PREFIX + flagKey);
      const item = {
        ...flag,
        get value() {
          return resolve(getAdmin(), getOwn());
        },
        get adminOverride() {
          return getAdmin();
        },
        set: (value: boolean) => {
          if (!configurable) {
            return;
          }
          this.globalState.set(FLAG_PREFIX + flagKey, value);
        },
        $: LiveData.from<boolean | undefined>(
          // Started with what is stored now: not every storage's watch sends
          // the current value, and combineLatest waits for both.
          combineLatest([
            this.globalState
              .watch<boolean>(adminKey)
              .pipe(startWith(getAdmin())),
            this.globalState
              .watch<boolean>(FLAG_PREFIX + flagKey)
              .pipe(startWith(getOwn())),
          ]).pipe(map(([admin, own]) => resolve(admin, own))),
          resolve(getAdmin(), getOwn())
        ),
      } as Flag<typeof flag>;
      Object.defineProperty(this, flagKey, {
        get: () => {
          return item;
        },
      });
    });
  }

  /**
   * Take what the server says an admin set, by flag key: listed flags follow
   * it, the rest go back to the user's own setting or the default.
   */
  applyAdminOverrides(overrides: Record<string, boolean>) {
    for (const key of Object.keys(NOTESGRAPH_FLAGS)) {
      const value =
        typeof overrides[key] === 'boolean' ? overrides[key] : undefined;
      if (this.globalState.get<boolean>(ADMIN_FLAG_PREFIX + key) !== value) {
        this.globalState.set(ADMIN_FLAG_PREFIX + key, value);
      }
    }
  }
}

export type FlagsExt = Flags & {
  [K in keyof NOTESGRAPH_FLAGS]: Flag<NOTESGRAPH_FLAGS[K]>;
};
