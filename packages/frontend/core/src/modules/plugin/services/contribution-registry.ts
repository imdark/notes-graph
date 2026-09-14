import { LiveData, Service } from '@notesgraph/infra';
import type {
  CommandSpec,
  PanelSpec,
  SettingsPageSpec,
  SlashMenuItemSpec,
  ToolbarItemSpec,
} from '@notesgraph/plugin-sdk/client';

export interface OwnedContribution<T> {
  pluginId: string;
  spec: T;
}

/**
 * Holds every UI contribution registered by active plugins. The app's UI
 * surfaces (command palette, right sidebar, settings, toolbar, slash menu)
 * subscribe to these and render them (wired in P3).
 */
export class PluginContributionRegistry extends Service {
  readonly commands$ = new LiveData<OwnedContribution<CommandSpec>[]>([]);
  readonly panels$ = new LiveData<OwnedContribution<PanelSpec>[]>([]);
  readonly toolbarItems$ = new LiveData<OwnedContribution<ToolbarItemSpec>[]>(
    []
  );
  readonly settingsPages$ = new LiveData<OwnedContribution<SettingsPageSpec>[]>(
    []
  );
  readonly slashItems$ = new LiveData<OwnedContribution<SlashMenuItemSpec>[]>(
    []
  );

  /**
   * Editor extensions (BlockSuite view-extension providers) contributed by
   * plugins via the `editor` capability. Providers have no stable id, so these
   * are tracked per registration entry rather than via {@link addTo}.
   */
  readonly editorExtensions$ = new LiveData<
    { pluginId: string; providers: unknown[] }[]
  >([]);

  private addTo<T extends { id: string }>(
    live$: LiveData<OwnedContribution<T>[]>,
    pluginId: string,
    spec: T
  ): () => void {
    live$.next([...live$.value, { pluginId, spec }]);
    return () =>
      live$.next(
        live$.value.filter(
          c => !(c.pluginId === pluginId && c.spec.id === spec.id)
        )
      );
  }

  addCommand(pluginId: string, spec: CommandSpec) {
    return this.addTo(this.commands$, pluginId, spec);
  }
  addPanel(pluginId: string, spec: PanelSpec) {
    return this.addTo(this.panels$, pluginId, spec);
  }
  addToolbarItem(pluginId: string, spec: ToolbarItemSpec) {
    return this.addTo(this.toolbarItems$, pluginId, spec);
  }
  addSettingsPage(pluginId: string, spec: SettingsPageSpec) {
    return this.addTo(this.settingsPages$, pluginId, spec);
  }
  addSlashItem(pluginId: string, spec: SlashMenuItemSpec) {
    return this.addTo(this.slashItems$, pluginId, spec);
  }

  addEditorExtensions(pluginId: string, providers: unknown[]) {
    const entry = { pluginId, providers };
    this.editorExtensions$.next([...this.editorExtensions$.value, entry]);
    return () =>
      this.editorExtensions$.next(
        this.editorExtensions$.value.filter(e => e !== entry)
      );
  }

  /** Remove every contribution owned by a plugin (on disable/uninstall). */
  removeAll(pluginId: string) {
    this.commands$.next(
      this.commands$.value.filter(c => c.pluginId !== pluginId)
    );
    this.panels$.next(this.panels$.value.filter(c => c.pluginId !== pluginId));
    this.toolbarItems$.next(
      this.toolbarItems$.value.filter(c => c.pluginId !== pluginId)
    );
    this.settingsPages$.next(
      this.settingsPages$.value.filter(c => c.pluginId !== pluginId)
    );
    this.slashItems$.next(
      this.slashItems$.value.filter(c => c.pluginId !== pluginId)
    );
    this.editorExtensions$.next(
      this.editorExtensions$.value.filter(c => c.pluginId !== pluginId)
    );
  }
}
