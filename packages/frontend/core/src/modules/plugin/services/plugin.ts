import { LiveData, Service } from '@notesgraph/infra';
import { parseManifest, type PluginManifest } from '@notesgraph/plugin-sdk';
import type {
  PluginContext,
  PluginDefinition,
} from '@notesgraph/plugin-sdk/client';

import type { GlobalState } from '../../storage';
import type { PluginContextFactory } from './context-factory';

const INSTALLED_KEY = 'plugin:installed';
const BUILTIN_ENABLED_PREFIX = 'plugin:builtin-enabled:';

export interface InstalledPlugin {
  manifest: PluginManifest;
  source: 'dev' | 'marketplace' | 'builtin';
  entryUrl: string;
  enabled: boolean;
  status: 'active' | 'error' | 'disabled';
  error?: string;
}

interface PersistedPlugin {
  entryUrl: string;
  source: InstalledPlugin['source'];
}

interface ActivePlugin {
  def: PluginDefinition;
  context: PluginContext;
  dispose: () => void;
}

/**
 * Loads plugins in-process: fetch the manifest, dynamic-`import()` the client
 * bundle, then call `activate(context)`. Tracks lifecycle and persists the list
 * of dev plugins so they reload on startup. Marketplace install (P4) reuses
 * {@link activate} with `source: 'marketplace'`.
 */
export class PluginService extends Service {
  readonly plugins$ = new LiveData<InstalledPlugin[]>([]);
  private readonly active = new Map<string, ActivePlugin>();
  // First-party plugins bundled with the app (registered via registerBuiltin).
  // Their code shares the host build, so they may use the `editor` capability.
  private readonly builtins = new Map<
    string,
    { manifest: PluginManifest; def: PluginDefinition }
  >();

  constructor(
    private readonly factory: PluginContextFactory,
    private readonly globalState: GlobalState
  ) {
    super();
    this.restore().catch(err => console.error('[plugin] restore failed', err));
  }

  /** Load (or reload) a plugin from a base URL serving manifest.json. */
  async loadFromUrl(
    baseUrl: string,
    source: InstalledPlugin['source']
  ): Promise<void> {
    const base = baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/manifest.json`);
    if (!res.ok) {
      const error = new Error(
        `failed to fetch manifest from ${base} (${res.status})`
      );
      (error as { status?: number }).status = res.status;
      throw error;
    }
    const manifest = parseManifest(await res.json());
    const clientEntry = manifest.entry.client ?? 'index.js';
    const mod = (await import(
      /* webpackIgnore: true */ `${base}/${clientEntry}`
    )) as { default?: PluginDefinition };
    if (!mod.default || typeof mod.default.activate !== 'function') {
      throw new Error(
        `plugin ${manifest.id} has no default export with activate()`
      );
    }
    await this.activate(manifest, mod.default, { source, entryUrl: base });
    this.persist();
  }

  /** Load a plugin from a local dev server / directory base URL. */
  loadDevPlugin(baseUrl: string): Promise<void> {
    return this.loadFromUrl(baseUrl, 'dev');
  }

  /** Install a plugin from a marketplace download base URL. */
  install(downloadBaseUrl: string): Promise<void> {
    return this.loadFromUrl(downloadBaseUrl, 'marketplace');
  }

  /**
   * Register a first-party plugin bundled with the app. Unlike dev/marketplace
   * plugins its code is part of the host build (so it shares the host's single
   * BlockSuite instance and may use the `editor` capability). It is never
   * fetched from a URL and is disabled by default; the user's last enable
   * choice is restored from persisted state.
   */
  registerBuiltin(manifest: PluginManifest, def: PluginDefinition) {
    this.builtins.set(manifest.id, { manifest, def });
    if (!this.plugins$.value.some(p => p.manifest.id === manifest.id)) {
      this.upsert({
        manifest,
        source: 'builtin',
        entryUrl: '',
        enabled: false,
        status: 'disabled',
      });
    }
    const enabled =
      this.globalState.get<boolean>(BUILTIN_ENABLED_PREFIX + manifest.id) ??
      false;
    if (enabled) {
      this.reload(manifest.id).catch(err =>
        console.error(`[plugin:${manifest.id}] builtin activate failed`, err)
      );
    }
  }

  /** Activate a resolved plugin definition (shared by dev-load + marketplace). */
  async activate(
    manifest: PluginManifest,
    def: PluginDefinition,
    info: { source: InstalledPlugin['source']; entryUrl: string }
  ): Promise<void> {
    this.deactivate(manifest.id);
    const { context, dispose } = this.factory.create(manifest);
    try {
      await def.activate(context);
      this.active.set(manifest.id, { def, context, dispose });
      this.upsert({ manifest, ...info, enabled: true, status: 'active' });
    } catch (err) {
      dispose();
      this.upsert({
        manifest,
        ...info,
        enabled: true,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Tear down a plugin's contributions but keep it in the list. */
  deactivate(id: string) {
    const plugin = this.active.get(id);
    if (!plugin) return;
    Promise.resolve(plugin.def.deactivate?.()).catch(err =>
      console.error(`[plugin:${id}] deactivate failed`, err)
    );
    plugin.dispose();
    this.active.delete(id);
  }

  setEnabled(id: string, enabled: boolean) {
    const current = this.plugins$.value.find(p => p.manifest.id === id);
    if (!current) return;
    // Persist the enable choice for built-ins so it survives restarts (they are
    // re-registered disabled-by-default on every launch).
    if (current.source === 'builtin') {
      this.globalState.set(BUILTIN_ENABLED_PREFIX + id, enabled);
    }
    if (enabled && current.status !== 'active') {
      this.reload(id).catch(err =>
        console.error(`[plugin:${id}] reload failed`, err)
      );
    } else if (!enabled) {
      this.deactivate(id);
      this.upsert({ ...current, enabled: false, status: 'disabled' });
    }
  }

  async reload(id: string): Promise<void> {
    const current = this.plugins$.value.find(p => p.manifest.id === id);
    if (!current) return;
    const builtin = this.builtins.get(id);
    if (builtin) {
      await this.activate(builtin.manifest, builtin.def, {
        source: 'builtin',
        entryUrl: '',
      });
      return;
    }
    await this.loadFromUrl(current.entryUrl, current.source);
  }

  uninstall(id: string) {
    this.deactivate(id);
    this.plugins$.next(this.plugins$.value.filter(p => p.manifest.id !== id));
    this.persist();
  }

  private upsert(plugin: InstalledPlugin) {
    const rest = this.plugins$.value.filter(
      p => p.manifest.id !== plugin.manifest.id
    );
    this.plugins$.next([...rest, plugin]);
  }

  private persist() {
    // Built-ins are re-registered from code each launch, not restored by URL.
    const list: PersistedPlugin[] = this.plugins$.value
      .filter(p => p.source !== 'builtin')
      .map(p => ({
        entryUrl: p.entryUrl,
        source: p.source,
      }));
    this.globalState.set(INSTALLED_KEY, list);
  }

  private async restore() {
    const list = this.globalState.get<PersistedPlugin[]>(INSTALLED_KEY) ?? [];
    const kept: PersistedPlugin[] = [];
    for (const persisted of list) {
      try {
        await this.loadFromUrl(persisted.entryUrl, persisted.source);
        kept.push(persisted);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404 || status === 410) {
          // Plugin is gone from its source — uninstalled, or its id changed
          // during the NotesGraph rebrand. Drop it so we stop retrying every
          // launch; the user can reinstall it.
          console.warn(
            `[plugin] dropping unavailable plugin ${persisted.entryUrl} (${status})`
          );
        } else {
          // Transient failure (source offline) — keep and retry next launch.
          kept.push(persisted);
          console.error(
            `[plugin] failed to restore ${persisted.entryUrl}`,
            err
          );
        }
      }
    }
    if (kept.length !== list.length) {
      this.globalState.set(INSTALLED_KEY, kept);
    }
  }
}
