export interface AppLockPluginState {
  available: boolean;
  enabled: boolean;
}

export interface AppLockPlugin {
  getState(): Promise<AppLockPluginState>;
  setEnabled(options: { enabled: boolean }): Promise<AppLockPluginState>;
}
