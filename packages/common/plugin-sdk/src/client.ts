import type { ComponentType, ReactNode } from 'react';

import type { Capability, Platform, PluginManifest } from './manifest';

/** Teardown returned by every `add*`/`on` call; collect in `subscriptions`. */
export type Disposable = () => void;

// --- Serializable doc/block shapes (decoupled from BlockSuite so the API can
// later run in a sandbox) ---------------------------------------------------

export interface PluginDoc {
  id: string;
  title: string;
  mode: 'page' | 'edgeless';
  createDate?: number;
  updatedDate?: number;
}

export interface PluginBlock {
  id: string;
  flavour: string;
  /** JSON-serializable props; rich text is exposed as a plain `text` string. */
  props: Record<string, unknown>;
  children: string[];
}

export interface DocsApi {
  list(): Promise<PluginDoc[]>;
  get(docId: string): Promise<PluginDoc | null>;
  getCurrent(): Promise<PluginDoc | null>;
  create(input?: { title?: string }): Promise<PluginDoc>;
  getBlocks(docId: string): Promise<PluginBlock[]>;
  insertBlock(
    docId: string,
    block: {
      flavour: string;
      props?: Record<string, unknown>;
      parent?: string;
      index?: number;
    }
  ): Promise<string>;
  updateBlock(
    docId: string,
    blockId: string,
    props: Record<string, unknown>
  ): Promise<void>;
  deleteBlock(docId: string, blockId: string): Promise<void>;
}

// --- UI contributions (host-rendered slots) --------------------------------

export interface CommandSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  keybinding?: string;
  run: () => void | Promise<void>;
}

export interface PanelSpec {
  id: string;
  title: string;
  icon?: ReactNode;
  component: ComponentType;
}

export interface ToolbarItemSpec {
  id: string;
  tooltip: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

export interface SettingsPageSpec {
  id: string;
  title: string;
  component: ComponentType;
}

export interface SlashMenuItemSpec {
  id: string;
  title: string;
  icon?: ReactNode;
  run: (ctx: { docId: string }) => void | Promise<void>;
}

export interface NotifySpec {
  title: string;
  message?: string;
  theme?: 'info' | 'success' | 'warning' | 'error';
}

export interface ImporterResult {
  /** Docs created by the import; lets the host navigate to them. */
  docIds?: string[];
}

/** Adds a button to NotesGraph's import dialog. */
export interface ImporterSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  /** File `accept` string, e.g. `.json,.txt`. Omit to accept any file. */
  accept?: string;
  multiple?: boolean;
  run: (
    files: File[]
  ) => void | ImporterResult | Promise<void | ImporterResult>;
}

export interface UiApi {
  addCommand(spec: CommandSpec): Disposable;
  addSidebarPanel(spec: PanelSpec): Disposable;
  addToolbarItem(spec: ToolbarItemSpec): Disposable;
  addSettingsPage(spec: SettingsPageSpec): Disposable;
  addSlashMenuItem(spec: SlashMenuItemSpec): Disposable;
  /** Contribute an import option to NotesGraph's import dialog. */
  addImporter(spec: ImporterSpec): Disposable;
  notify(spec: NotifySpec): void;
}

// --- Editor (in-process / first-party only) --------------------------------

/**
 * Contribute BlockSuite editor extensions. Unlike the other capabilities this
 * one hands live objects (BlockSuite `ViewExtensionProvider` classes) straight
 * to the host, so it only works for in-process / first-party plugins that share
 * the host's single BlockSuite instance — not sandboxed or externally-bundled
 * plugins (those would duplicate lit custom elements and module singletons).
 */
export interface EditorApi {
  /**
   * Register one or more BlockSuite view-extension providers into the editor.
   * They are added to the host's `ViewExtensionManager` and picked up on the
   * next editor render; the returned disposable removes them again.
   */
  registerViewExtensions(providers: unknown[]): Disposable;
}

/**
 * A doc editing mode contributed by a plugin (e.g. the edgeless/whiteboard
 * mode). The host renders mode toggles, create entries, the primary-mode
 * property, the new-doc-default setting, and the editor itself from the set of
 * registered modes. Like {@link EditorApi} this is in-process / first-party
 * only — the descriptor carries live React/BlockSuite objects.
 */
export interface DocModeContribution {
  /** Doc mode id, e.g. 'edgeless'. */
  id: string;
  /** i18n key for the mode's display name. */
  labelKey: string;
  /** React icon for create menus and the primary-mode property. */
  icon?: ComponentType;
  /** Custom toggle label (e.g. an animated switch item). */
  toggleItem?: ReactNode;
  /** Lit icon factory for the `@`-menu "create" item. */
  creationIcon?: () => unknown;
  /** Offered when creating docs / as a new-doc default. */
  creatable?: boolean;
  /** Sort order across mode surfaces. */
  order?: number;
  /** Editor component (BlockSuite forwardRef component) for this mode. */
  editor?: unknown;
  /** BlockSuite view-extension providers contributed while this mode exists. */
  viewExtensions?: unknown[];
}

export interface DocModesApi {
  /** Register a doc editing mode; the returned disposable removes it again. */
  register(mode: DocModeContribution): Disposable;
}

// --- Hooks / commands / storage / backend / net / native -------------------

export type PluginEvent =
  | 'app.open'
  | 'doc.open'
  | 'doc.close'
  | 'doc.save'
  | 'selection.change'
  | 'navigate'
  | 'sync';

export interface HooksApi {
  on(event: PluginEvent, handler: (payload: unknown) => void): Disposable;
}

export interface CommandsApi {
  register(id: string, run: (...args: unknown[]) => unknown): Disposable;
  run(id: string, ...args: unknown[]): Promise<unknown>;
}

export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  blob: {
    put(key: string, data: Blob | Uint8Array): Promise<void>;
    get(key: string): Promise<Blob | undefined>;
    delete(key: string): Promise<void>;
  };
}

export interface BackendApi {
  /** Invoke a function from the plugin's `server.js` running in the sidecar. */
  invoke<T = unknown>(fn: string, payload?: unknown): Promise<T>;
}

export interface NetApi {
  /** Proxied fetch (avoids CORS / mixed-content; subject to host policy). */
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** Platform-gated; members are undefined where the platform doesn't support them. */
export interface NativeApi {
  readonly available: boolean;
  readonly platform: Platform;
  fs?: {
    read(path: string): Promise<Uint8Array>;
    write(path: string, data: Uint8Array): Promise<void>;
  };
  notify?(title: string, body?: string): Promise<void>;
  openExternal?(url: string): Promise<void>;
}

export interface PluginContext {
  readonly id: string;
  readonly manifest: PluginManifest;
  readonly platform: Platform;
  readonly grantedPermissions: Capability[];
  readonly docs: DocsApi;
  readonly ui: UiApi;
  readonly editor: EditorApi;
  readonly docModes: DocModesApi;
  readonly hooks: HooksApi;
  readonly commands: CommandsApi;
  readonly storage: StorageApi;
  readonly backend: BackendApi;
  readonly net: NetApi;
  readonly native: NativeApi;
  /** Disposables registered here are torn down automatically on deactivate. */
  readonly subscriptions: Disposable[];
}

export interface PluginDefinition {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** Identity helper a plugin's client entry exports as `default`. */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}
