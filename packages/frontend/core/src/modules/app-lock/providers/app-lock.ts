import { createIdentifier } from '@notesgraph/infra';

export interface AppLockState {
  /** The device has a screen lock or biometric to unlock with. */
  available: boolean;
  enabled: boolean;
}

/**
 * Native lock on opening the app (device PIN/biometric). Implemented only
 * where the platform has one - the Android app today - so everything here is
 * optional: no provider, no setting.
 */
export interface AppLockProvider {
  getState(): Promise<AppLockState>;
  /**
   * Turning it on prompts for an unlock first and only enables on success,
   * so the result can differ from what was asked for.
   */
  setEnabled(enabled: boolean): Promise<AppLockState>;
}

export const AppLockProvider =
  createIdentifier<AppLockProvider>('AppLockProvider');
