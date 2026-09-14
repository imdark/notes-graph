import {
  type BlockModel,
  type Store,
  Text,
} from '@blocksuite/notesgraph/store';
import { notify } from '@notesgraph/component';
import { Service } from '@notesgraph/infra';
import type {
  Capability,
  Platform,
  PluginManifest,
} from '@notesgraph/plugin-sdk';
import type {
  BackendApi,
  CommandsApi,
  DocModesApi,
  DocsApi,
  EditorApi,
  HooksApi,
  NativeApi,
  NetApi,
  PluginBlock,
  PluginContext,
  PluginDoc,
  PluginEvent,
  StorageApi,
  UiApi,
} from '@notesgraph/plugin-sdk/client';

import { DesktopApiService } from '../../desktop-api';
import type { DocRecord, DocsService } from '../../doc';
import {
  type DocModeDescriptor,
  DocModeRegistryService,
} from '../../doc-mode-registry';
import type { GlobalContextService } from '../../global-context';
import type { ImportRegistryService } from '../../import';
import type { GlobalState } from '../../storage';
import { getPluginMarketplaceBaseUrl } from '../marketplace';
import type { PluginContributionRegistry } from './contribution-registry';

type EventHandler = (payload: unknown) => void;

function currentPlatform(): Platform {
  if (BUILD_CONFIG.isElectron) return 'desktop';
  if (BUILD_CONFIG.isMobileEdition) return 'mobile';
  return 'web';
}

function u8ToBase64(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}
function base64ToU8(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function toPluginDoc(record: DocRecord): PluginDoc {
  return {
    id: record.id,
    title: record.title$.value,
    mode: record.primaryMode$.value,
  };
}

function serializeBlock(model: BlockModel): PluginBlock {
  const props: Record<string, unknown> = {};
  const raw = model.props as Record<string, unknown>;
  for (const key of model.keys) {
    const value = raw[key];
    if (value == null) continue;
    // Rich text (BlockSuite Text / Y.Text) → plain string.
    if (key === 'text' || key === 'title') {
      props[key] = String(value);
      continue;
    }
    try {
      props[key] = JSON.parse(JSON.stringify(value));
    } catch {
      // skip non-serializable props (yjs containers, etc.)
    }
  }
  return {
    id: model.id,
    flavour: model.flavour,
    props,
    children: model.children.map(child => child.id),
  };
}

// Convert plain `text` strings back into a BlockSuite Text for writes.
function deserializeProps(
  props?: Record<string, unknown>
): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = { ...props };
  for (const key of ['text', 'title']) {
    if (typeof out[key] === 'string') out[key] = new Text(out[key] as string);
  }
  return out;
}

/**
 * Builds the per-plugin {@link PluginContext} bound to host services. Capability
 * methods are gated by the plugin's granted permissions. v1 runs plugins
 * in-process, but the surface is async + serializable so it can move to a
 * sandbox later. (docs → P3, backend → P5, native → P6.)
 */
export class PluginContextFactory extends Service {
  // pluginId -> event -> handlers
  private readonly handlers = new Map<string, Map<string, Set<EventHandler>>>();
  // The active workspace's DocsService, fed by a workspace-scoped React bridge
  // (the factory itself is app/root-scoped).
  private activeDocs: DocsService | null = null;

  constructor(
    private readonly registry: PluginContributionRegistry,
    private readonly globalState: GlobalState,
    private readonly globalContext: GlobalContextService,
    private readonly importRegistry: ImportRegistryService
  ) {
    super();
  }

  setActiveDocs(docs: DocsService | null) {
    this.activeDocs = docs;
  }

  private requireDocs(pluginId: string): DocsService {
    if (!this.activeDocs) {
      throw new Error(`[plugin:${pluginId}] no active workspace`);
    }
    return this.activeDocs;
  }

  // Docs whose store we've already confirmed ready this session, so repeated
  // ops (e.g. an import inserting many blocks) don't re-wait per call.
  private readonly readyDocs = new Set<string>();

  // Open a doc, wait until it's loaded, run `fn` against its BlockSuite store,
  // then release. The wait is time-boxed: a freshly created doc is already
  // materialized, so if the sync engine never reports it "loaded" we proceed
  // (and warn) rather than hang the caller forever.
  private async withStore<T>(
    docs: DocsService,
    docId: string,
    fn: (store: Store) => T
  ): Promise<T> {
    const { doc, release } = docs.open(docId);
    try {
      if (!this.readyDocs.has(docId)) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          doc.waitForSyncReady(),
          new Promise<void>(resolve => {
            timer = setTimeout(() => {
              console.warn(
                `[plugin] doc ${docId} not sync-ready after 5s; proceeding anyway`
              );
              resolve();
            }, 5000);
          }),
        ]);
        if (timer) clearTimeout(timer);
        this.readyDocs.add(docId);
      }
      return fn(doc.blockSuiteDoc);
    } finally {
      release();
    }
  }

  /** Dispatch a host event to every active plugin that subscribed. */
  emit(event: PluginEvent, payload?: unknown) {
    for (const byEvent of this.handlers.values()) {
      for (const handler of byEvent.get(event) ?? []) {
        try {
          handler(payload);
        } catch (err) {
          console.error('[plugin] hook handler failed', err);
        }
      }
    }
  }

  create(manifest: PluginManifest): {
    context: PluginContext;
    dispose: () => void;
  } {
    const pluginId = manifest.id;
    const granted = manifest.permissions;
    const platform = currentPlatform();
    const desktopApi = this.framework.getOptional(DesktopApiService);
    const subscriptions: PluginContext['subscriptions'] = [];

    const req = (cap: Capability) => {
      if (!granted.includes(cap)) {
        throw new Error(`[plugin:${pluginId}] missing permission: ${cap}`);
      }
    };
    const key = (kind: string, k: string) => `plugin:${pluginId}:${kind}:${k}`;
    const prefix = (kind: string) => `plugin:${pluginId}:${kind}:`;

    const ui: UiApi = {
      addCommand: spec => {
        req('ui');
        const d = this.registry.addCommand(pluginId, spec);
        subscriptions.push(d);
        return d;
      },
      addSidebarPanel: spec => {
        req('ui');
        const d = this.registry.addPanel(pluginId, spec);
        subscriptions.push(d);
        return d;
      },
      addToolbarItem: spec => {
        req('ui');
        const d = this.registry.addToolbarItem(pluginId, spec);
        subscriptions.push(d);
        return d;
      },
      addSettingsPage: spec => {
        req('ui');
        const d = this.registry.addSettingsPage(pluginId, spec);
        subscriptions.push(d);
        return d;
      },
      addSlashMenuItem: spec => {
        req('ui');
        const d = this.registry.addSlashItem(pluginId, spec);
        subscriptions.push(d);
        return d;
      },
      addImporter: spec => {
        req('ui');
        const d = this.importRegistry.register(pluginId, spec);
        subscriptions.push(d);
        return d;
      },
      notify: spec => {
        req('ui');
        notify({
          title: spec.title,
          message: spec.message,
          theme: spec.theme,
        });
      },
    };

    const editor: EditorApi = {
      registerViewExtensions: providers => {
        req('editor');
        const d = this.registry.addEditorExtensions(pluginId, providers);
        subscriptions.push(d);
        return d;
      },
    };

    const docModes: DocModesApi = {
      register: mode => {
        req('docModes');
        const d = this.framework
          .get(DocModeRegistryService)
          .register(mode as unknown as DocModeDescriptor);
        subscriptions.push(d);
        return d;
      },
    };

    const runners = new Map<string, (...args: unknown[]) => unknown>();
    const commands: CommandsApi = {
      register: (id, run) => {
        req('commands');
        runners.set(id, run);
        const d = () => runners.delete(id);
        subscriptions.push(d);
        return d;
      },
      run: async (id, ...args) => {
        req('commands');
        const run = runners.get(id);
        if (!run)
          throw new Error(`[plugin:${pluginId}] command not found: ${id}`);
        return run(...args);
      },
    };

    const hooks: HooksApi = {
      on: (event, handler) => {
        req('hooks');
        let byEvent = this.handlers.get(pluginId);
        if (!byEvent) {
          byEvent = new Map();
          this.handlers.set(pluginId, byEvent);
        }
        let set = byEvent.get(event);
        if (!set) {
          set = new Set();
          byEvent.set(event, set);
        }
        set.add(handler);
        const d = () => {
          this.handlers.get(pluginId)?.get(event)?.delete(handler);
        };
        subscriptions.push(d);
        return d;
      },
    };

    const storage: StorageApi = {
      get: k => {
        req('storage');
        return Promise.resolve(this.globalState.get(key('kv', k)));
      },
      set: (k, value) => {
        req('storage');
        this.globalState.set(key('kv', k), value);
        return Promise.resolve();
      },
      delete: k => {
        req('storage');
        this.globalState.del(key('kv', k));
        return Promise.resolve();
      },
      keys: () => {
        req('storage');
        const p = prefix('kv');
        return Promise.resolve(
          this.globalState
            .keys()
            .filter(k => k.startsWith(p))
            .map(k => k.slice(p.length))
        );
      },
      blob: {
        put: async (k, data) => {
          req('storage');
          const bytes =
            data instanceof Uint8Array
              ? data
              : new Uint8Array(await data.arrayBuffer());
          this.globalState.set(key('blob', k), u8ToBase64(bytes));
        },
        get: k => {
          req('storage');
          const b64 = this.globalState.get<string>(key('blob', k));
          return Promise.resolve(
            b64 == null
              ? undefined
              : new Blob([base64ToU8(b64).buffer as ArrayBuffer])
          );
        },
        delete: k => {
          req('storage');
          this.globalState.del(key('blob', k));
          return Promise.resolve();
        },
      },
    };

    const net: NetApi = {
      fetch: (url, init) => {
        req('net');
        return fetch(url, init);
      },
    };

    const docs: DocsApi = {
      list: async () => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        return [...ds.list.docsMap$.value.values()].map(toPluginDoc);
      },
      get: async docId => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        const record = ds.list.doc$(docId).value;
        return record ? toPluginDoc(record) : null;
      },
      getCurrent: async () => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        const docId = this.globalContext.globalContext.docId.get();
        if (!docId) return null;
        const record = ds.list.doc$(docId).value;
        return record ? toPluginDoc(record) : null;
      },
      create: async input => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        return toPluginDoc(ds.createDoc({ title: input?.title }));
      },
      getBlocks: async docId => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        return this.withStore(ds, docId, store =>
          store.getAllModels().map(serializeBlock)
        );
      },
      insertBlock: async (docId, block) => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        return this.withStore(ds, docId, store =>
          store.addBlock(
            block.flavour,
            deserializeProps(block.props),
            block.parent ?? undefined,
            block.index
          )
        );
      },
      updateBlock: async (docId, blockId, props) => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        await this.withStore(ds, docId, store =>
          store.updateBlock(blockId, deserializeProps(props))
        );
      },
      deleteBlock: async (docId, blockId) => {
        req('docs');
        const ds = this.requireDocs(pluginId);
        await this.withStore(ds, docId, store => store.deleteBlock(blockId));
      },
    };

    const backend: BackendApi = {
      invoke: async <T>(fn: string, payload?: unknown): Promise<T> => {
        req('backend');
        const res = await fetch(
          `${getPluginMarketplaceBaseUrl()}/p/${encodeURIComponent(
            pluginId
          )}/${encodeURIComponent(fn)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload ?? null),
          }
        );
        if (!res.ok) {
          throw new Error(
            `[plugin:${pluginId}] backend.invoke(${fn}) failed (${res.status})`
          );
        }
        const data = (await res.json()) as { result: T };
        return data.result;
      },
    };

    const native: NativeApi =
      desktopApi && platform === 'desktop'
        ? {
            available: true,
            platform,
            notify: async (title, body) => {
              req('native');
              await desktopApi.handler.plugin.notify(title, body);
            },
            openExternal: async url => {
              req('native');
              await desktopApi.handler.plugin.openExternal(url);
            },
            fs: {
              read: async path => {
                req('native');
                return base64ToU8(
                  await desktopApi.handler.plugin.fsRead(pluginId, path)
                );
              },
              write: async (path, data) => {
                req('native');
                await desktopApi.handler.plugin.fsWrite(
                  pluginId,
                  path,
                  u8ToBase64(data)
                );
              },
            },
          }
        : {
            // web + mobile: no native FS; best-effort notify / open.
            available: false,
            platform,
            notify: (title, body) => {
              req('native');
              notify({ title, message: body });
              return Promise.resolve();
            },
            openExternal: url => {
              req('native');
              globalThis.open?.(url, '_blank', 'noopener');
              return Promise.resolve();
            },
          };

    const context: PluginContext = {
      id: pluginId,
      manifest,
      platform,
      grantedPermissions: granted,
      docs,
      ui,
      editor,
      docModes,
      hooks,
      commands,
      storage,
      backend,
      net,
      native,
      subscriptions,
    };

    const dispose = () => {
      for (const d of subscriptions.splice(0)) {
        try {
          d();
        } catch (err) {
          console.error('[plugin] dispose failed', err);
        }
      }
      this.handlers.delete(pluginId);
      this.registry.removeAll(pluginId);
    };

    return { context, dispose };
  }
}
