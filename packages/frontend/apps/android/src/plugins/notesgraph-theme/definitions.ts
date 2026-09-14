export interface NotesGraphThemePlugin {
  onThemeChanged(options: { darkMode: boolean }): Promise<void>;
  getSystemNavBarHeight(): Promise<{ height: number }>;
}
