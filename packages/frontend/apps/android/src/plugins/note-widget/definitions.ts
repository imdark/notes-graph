export interface NoteWidgetPlugin {
  /**
   * The cloud workspace the app has open, which home-screen note widgets
   * read from. Both null for a local workspace: a widget can only show a
   * note the server has.
   */
  setWorkspace(options: {
    server: string | null;
    workspaceId: string | null;
  }): Promise<{ ok: boolean }>;
}
