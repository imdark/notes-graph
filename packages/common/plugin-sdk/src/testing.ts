/**
 * A test harness for NotesGraph plugins.
 *
 * A plugin is just a module exporting `activate(ctx)`, so testing one means
 * handing it a context and inspecting what it did with it. This builds that
 * context out of in-memory fakes, records every contribution, and lets a test
 * drive the results — no host, no browser, no marketplace.
 *
 *   const harness = createPluginHarness({
 *     manifest,
 *     fetch: async () => jsonResponse(200, { devices: [] }),
 *   });
 *   await harness.activate(plugin);
 *   expect(harness.settingsPages.map(p => p.id)).toEqual(['devices']);
 *
 * Rendering a contributed component needs a DOM, so a spec that does it opens
 * with `@vitest-environment happy-dom` and uses @testing-library/react. The
 * context half of the harness is plain node and needs neither.
 *
 * Note what this deliberately does NOT reproduce: in the real app a plugin is
 * a separate ESM bundle that gets the host's React through an import map. In a
 * test the plugin and the test share node's module graph, so they share React
 * anyway. A harness test therefore cannot catch a *packaging* mistake (a
 * plugin that bundles its own React); it tests behaviour, not delivery.
 */
import type {
  Capability,
  Platform,
  PluginManifest,
} from './manifest';
import type {
  CommandSpec,
  Disposable,
  ImporterSpec,
  NotifySpec,
  PanelSpec,
  PluginContext,
  PluginDefinition,
  PluginDoc,
  PluginEvent,
  SettingsPageSpec,
  SlashMenuItemSpec,
  ToolbarItemSpec,
} from './client';

export interface HarnessOptions {
  manifest: PluginManifest;
  /**
   * Overrides the manifest's own permissions, so a test can check that a
   * plugin fails loudly when a capability it uses was not granted.
   */
  permissions?: Capability[];
  platform?: Platform;
  /** What `ctx.workspace.getCurrent()` returns. Null models "no workspace". */
  workspace?: { id: string } | null;
  /** Backs `ctx.net.fetch`. Throws by default, so an unstubbed call is loud. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Backs `ctx.backend.invoke`, keyed by function name. */
  backend?: Record<string, (payload?: unknown) => unknown>;
  /** Seeds `ctx.docs`. */
  docs?: PluginDoc[];
}

export interface RecordedFetch {
  url: string;
  init?: RequestInit;
}

export interface PluginHarness {
  readonly context: PluginContext;
  activate(plugin: PluginDefinition): Promise<void>;
  deactivate(): Promise<void>;

  /** Contributions, in registration order. */
  readonly commands: CommandSpec[];
  readonly settingsPages: SettingsPageSpec[];
  readonly sidebarPanels: PanelSpec[];
  readonly toolbarItems: ToolbarItemSpec[];
  readonly slashItems: SlashMenuItemSpec[];
  readonly importers: ImporterSpec[];

  /** Everything the plugin passed to `ui.notify`. */
  readonly notifications: NotifySpec[];
  /** Every `net.fetch` call, in order. */
  readonly requests: RecordedFetch[];

  /** Run a registered command by id. Throws if there is no such command. */
  runCommand(id: string): Promise<void>;
  /** Fire a host event at the plugin's `hooks.on` handlers. */
  emit(event: PluginEvent, payload?: unknown): void;
  /** Read the plugin's key/value storage, for asserting on what it persisted. */
  readStorage(): Record<string, unknown>;
}

/** Build a `Response`-alike for `fetch` stubs, without needing a real one. */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

export function createPluginHarness(options: HarnessOptions): PluginHarness {
  const {
    manifest,
    permissions = manifest.permissions,
    platform = 'web',
    workspace = { id: 'test-workspace' },
    backend = {},
    docs: seedDocs = [],
  } = options;

  const commands: CommandSpec[] = [];
  const settingsPages: SettingsPageSpec[] = [];
  const sidebarPanels: PanelSpec[] = [];
  const toolbarItems: ToolbarItemSpec[] = [];
  const slashItems: SlashMenuItemSpec[] = [];
  const importers: ImporterSpec[] = [];
  const notifications: NotifySpec[] = [];
  const requests: RecordedFetch[] = [];
  const store = new Map<string, unknown>();
  const blobs = new Map<string, Blob | Uint8Array>();
  const hooks = new Map<PluginEvent, Set<(payload: unknown) => void>>();
  const subscriptions: Disposable[] = [];
  const docs = [...seedDocs];

  // The host throws on an ungranted capability; matching that here is the
  // point — a permission a plugin forgot to declare should fail in a test
  // rather than in someone's browser.
  const req = (cap: Capability) => {
    if (!permissions.includes(cap)) {
      throw new Error(`[plugin:${manifest.id}] missing permission: ${cap}`);
    }
  };

  const track = <T extends { id?: string }>(list: T[], spec: T): Disposable => {
    list.push(spec);
    const dispose = () => {
      const i = list.indexOf(spec);
      if (i >= 0) list.splice(i, 1);
    };
    subscriptions.push(dispose);
    return dispose;
  };

  const fetchImpl =
    options.fetch ??
    (async (url: string) => {
      throw new Error(
        `[plugin-harness] unstubbed net.fetch(${url}) — pass a \`fetch\` option`
      );
    });

  const context: PluginContext = {
    id: manifest.id,
    manifest,
    platform,
    grantedPermissions: permissions,
    docs: {
      list: async () => {
        req('docs');
        return [...docs];
      },
      get: async id => {
        req('docs');
        return docs.find(d => d.id === id) ?? null;
      },
      getCurrent: async () => {
        req('docs');
        return docs[0] ?? null;
      },
      create: async input => {
        req('docs');
        const doc: PluginDoc = {
          id: `doc-${docs.length + 1}`,
          title: input?.title ?? 'Untitled',
          mode: 'page',
        };
        docs.push(doc);
        return doc;
      },
      getBlocks: async () => {
        req('docs');
        return [];
      },
      insertBlock: async () => {
        req('docs');
        return 'block-1';
      },
      updateBlock: async () => {
        req('docs');
      },
      deleteBlock: async () => {
        req('docs');
      },
    },
    workspace: {
      getCurrent: async () => {
        req('workspace');
        return workspace;
      },
    },
    ui: {
      addCommand: spec => {
        req('ui');
        return track(commands, spec);
      },
      addSidebarPanel: spec => {
        req('ui');
        return track(sidebarPanels, spec);
      },
      addToolbarItem: spec => {
        req('ui');
        return track(toolbarItems, spec);
      },
      addSettingsPage: spec => {
        req('ui');
        return track(settingsPages, spec);
      },
      addSlashMenuItem: spec => {
        req('ui');
        return track(slashItems, spec);
      },
      addImporter: spec => {
        req('ui');
        return track(importers, spec);
      },
      notify: spec => {
        req('ui');
        notifications.push(spec);
      },
    },
    editor: {
      registerViewExtensions: () => {
        req('editor');
        return () => {};
      },
    },
    docModes: {
      register: () => {
        req('docModes');
        return () => {};
      },
    },
    hooks: {
      on: (event, handler) => {
        req('hooks');
        const set = hooks.get(event) ?? new Set();
        set.add(handler);
        hooks.set(event, set);
        const dispose = () => set.delete(handler);
        subscriptions.push(dispose);
        return dispose;
      },
    },
    commands: {
      register: () => {
        req('commands');
        return () => {};
      },
      run: async () => {
        req('commands');
        return undefined;
      },
    },
    storage: {
      get: async key => {
        req('storage');
        return store.get(key) as never;
      },
      set: async (key, value) => {
        req('storage');
        store.set(key, value);
      },
      delete: async key => {
        req('storage');
        store.delete(key);
      },
      keys: async () => {
        req('storage');
        return [...store.keys()];
      },
      blob: {
        put: async (key, data) => {
          req('storage');
          blobs.set(key, data);
        },
        get: async key => {
          req('storage');
          return blobs.get(key) as Blob | undefined;
        },
        delete: async key => {
          req('storage');
          blobs.delete(key);
        },
      },
    },
    backend: {
      invoke: async (fn, payload) => {
        req('backend');
        const impl = backend[fn];
        if (!impl) {
          throw new Error(`[plugin-harness] no backend stub for '${fn}'`);
        }
        return (await impl(payload)) as never;
      },
    },
    net: {
      fetch: async (url, init) => {
        req('net');
        requests.push({ url, init });
        return fetchImpl(url, init);
      },
    },
    native: {
      available: false,
      platform,
    },
    subscriptions,
  };

  let active: PluginDefinition | null = null;

  return {
    context,
    commands,
    settingsPages,
    sidebarPanels,
    toolbarItems,
    slashItems,
    importers,
    notifications,
    requests,

    async activate(plugin) {
      await plugin.activate(context);
      active = plugin;
    },

    async deactivate() {
      await active?.deactivate?.();
      // Same teardown contract the host honours: everything a plugin pushed
      // onto `subscriptions` is disposed, so a test can assert that its
      // contributions really go away.
      for (const dispose of subscriptions.splice(0)) dispose();
      active = null;
    },

    async runCommand(id) {
      const command = commands.find(c => c.id === id);
      if (!command) {
        throw new Error(
          `[plugin-harness] no command '${id}' (have: ${commands
            .map(c => c.id)
            .join(', ')})`
        );
      }
      await command.run();
    },

    emit(event, payload) {
      for (const handler of hooks.get(event) ?? []) handler(payload);
    },

    readStorage() {
      return Object.fromEntries(store);
    },
  };
}
