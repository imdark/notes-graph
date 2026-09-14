import { Container } from '@blocksuite/notesgraph/global/di';
import {
  docLinkBaseURLMiddleware,
  MarkdownAdapter,
  titleMiddleware,
} from '@blocksuite/notesgraph/shared/adapters';
import { App as CapacitorApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { InAppBrowser } from '@capgo/inappbrowser';
import { notify } from '@notesgraph/component';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { NotesGraphContext } from '@notesgraph/core/components/context';
import { AppFallback } from '@notesgraph/core/mobile/components/app-fallback';
import { DebugConsole } from '@notesgraph/core/mobile/components/debug-console';
import { configureMobileModules } from '@notesgraph/core/mobile/modules';
import { setupBackgroundSyncManifest } from './background-sync-glue';
import { VirtualKeyboardProvider } from '@notesgraph/core/mobile/modules/virtual-keyboard';
import { router } from '@notesgraph/core/mobile/router';
import { configureCommonModules } from '@notesgraph/core/modules';
import { AIButtonProvider } from '@notesgraph/core/modules/ai-button';
import {
  AuthProvider,
  AuthService,
  DefaultServerService,
  ServerScope,
  ServerService,
  ServersService,
  ValidatorProvider,
} from '@notesgraph/core/modules/cloud';
import { registerNativePreviewHandlers } from '@notesgraph/core/modules/code-block-preview-renderer';
import { DocsService } from '@notesgraph/core/modules/doc';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { I18nProvider } from '@notesgraph/core/modules/i18n';
import { LifecycleService } from '@notesgraph/core/modules/lifecycle';
import {
  configureLocalStorageStateStorageImpls,
  NbstoreProvider,
} from '@notesgraph/core/modules/storage';
import { PopupWindowProvider } from '@notesgraph/core/modules/url';
import { ClientSchemeProvider } from '@notesgraph/core/modules/url/providers/client-schema';
import {
  configureBrowserWorkbenchModule,
  WorkbenchService,
} from '@notesgraph/core/modules/workbench';
import { WorkspacesService } from '@notesgraph/core/modules/workspace';
import { configureBrowserWorkspaceFlavours } from '@notesgraph/core/modules/workspace-engine';
import { getWorkerUrl } from '@notesgraph/env/worker';
import { I18n } from '@notesgraph/i18n';
import { Framework, FrameworkRoot, getCurrentStore } from '@notesgraph/infra';
import { OpClient } from '@notesgraph/infra/op';
import { StoreManagerClient } from '@notesgraph/nbstore/worker/client';
import { setTelemetryTransport } from '@notesgraph/track';
import { AsyncCall } from 'async-call-rpc';
import { useTheme } from 'next-themes';
import { Suspense, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import { AIButton } from './plugins/ai-button';
import { Auth } from './plugins/auth';
import { HashCash } from './plugins/hashcash';
import { NbStoreNativeDBApis } from './plugins/nbstore';
import { NotesGraphTheme } from './plugins/notesgraph-theme';
import { Preview } from './plugins/preview';
import {
  deleteEndpointToken,
  readEndpointToken,
  writeEndpointToken,
} from './proxy';

const storeManagerClient = createStoreManagerClient();
setTelemetryTransport(storeManagerClient.telemetry);
window.addEventListener('beforeunload', () => {
  storeManagerClient.dispose();
});

const future = {
  v7_startTransition: true,
} as const;

const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework);
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
configureMobileModules(framework);
framework.impl(NbstoreProvider, {
  realtime: storeManagerClient.realtime,
  openStore(key, options) {
    const { store, dispose } = storeManagerClient.open(key, options);
    return {
      store,
      dispose: () => {
        dispose();
      },
    };
  },
});
// Route auth through the native Capacitor plugin (native JWT flow) instead of
// the default web cookie fetch. MUST be registered before `framework.provider()`
// below — once the provider (and the default server scope) is created, a later
// override no longer lands, so login would silently fall back to the web/cookie
// path (which fails cross-origin in the WebView → login loop).
framework.scope(ServerScope).override(AuthProvider, resolver => {
  const serverService = resolver.get(ServerService);
  const endpoint = serverService.server.baseUrl;
  return {
    async signInMagicLink(email, linkToken, clientNonce) {
      const { token } = await Auth.signInMagicLink({
        endpoint,
        email,
        token: linkToken,
        clientNonce,
      });
      await writeEndpointToken(endpoint, token);
    },
    async signInOauth(code, state, _provider, clientNonce) {
      const { token } = await Auth.signInOauth({
        endpoint,
        code,
        state,
        clientNonce,
      });
      await writeEndpointToken(endpoint, token);
      return {};
    },
    async signInPassword(credential) {
      const { token } = await Auth.signInPassword({
        endpoint,
        ...credential,
      });
      await writeEndpointToken(endpoint, token);
    },
    async signInOpenAppSignInCode(code) {
      const { token } = await Auth.signInOpenApp({
        endpoint,
        code,
      });
      await writeEndpointToken(endpoint, token);
    },
    async signOut() {
      const token = await readEndpointToken(endpoint);
      try {
        await Auth.signOut({ endpoint, token });
      } finally {
        await deleteEndpointToken(endpoint);
      }
    },
  };
});

const frameworkProvider = framework.provider();

// Keep the native background push-sync manifest in step with the app state.
setupBackgroundSyncManifest(frameworkProvider);

registerNativePreviewHandlers({
  renderMermaidSvg: request => Preview.renderMermaidSvg(request),
  renderTypstSvg: request => Preview.renderTypstSvg(request),
});

framework.impl(PopupWindowProvider, {
  open: (url: string) => {
    InAppBrowser.open({
      url: url,
    }).catch(console.error);
  },
});

framework.impl(ClientSchemeProvider, {
  getClientScheme() {
    return 'notesgraph';
  },
});

framework.impl(VirtualKeyboardProvider, {
  show: () => {
    Keyboard.show().catch(console.error);
  },
  hide: () => {
    // In some cases, the keyboard will show again. for example, it will show again
    // when this function is called in click event of button. It may be a bug of
    // android webview or capacitor.
    setTimeout(() => {
      Keyboard.hide().catch(console.error);
    });
  },
  onChange: callback => {
    let disposeRef = {
      dispose: () => {},
    };

    Promise.all([
      Keyboard.addListener('keyboardWillShow', info => {
        (async () => {
          const navBarHeight = (await NotesGraphTheme.getSystemNavBarHeight())
            .height;
          callback({
            // When an physical keyboard is connected, the virtual keyboard height is 0,
            // even though the `keyboardWillShow` event is still triggered.
            visible: info.keyboardHeight !== 0,
            height: info.keyboardHeight - navBarHeight,
          });
        })().catch(console.error);
      }),
      Keyboard.addListener('keyboardWillHide', () => {
        callback({
          visible: false,
          height: 0,
        });
      }),
    ])
      .then(handlers => {
        disposeRef.dispose = () => {
          Promise.all(handlers.map(handler => handler.remove())).catch(
            console.error
          );
        };
      })
      .catch(console.error);

    return () => {
      disposeRef.dispose();
    };
  },
});

framework.impl(ValidatorProvider, {
  async validate(_challenge, resource) {
    const res = await HashCash.hash({ challenge: resource });
    return res.value;
  },
});

framework.impl(AIButtonProvider, {
  presentAIButton: () => {
    return AIButton.present();
  },
  dismissAIButton: () => {
    return AIButton.dismiss();
  },
});

// ------ some apis for native ------
(window as any).getCurrentServerBaseUrl = () => {
  const globalContextService = frameworkProvider.get(GlobalContextService);
  const currentServerId = globalContextService.globalContext.serverId.get();
  const serversService = frameworkProvider.get(ServersService);
  const defaultServerService = frameworkProvider.get(DefaultServerService);
  const currentServer =
    (currentServerId ? serversService.server$(currentServerId).value : null) ??
    defaultServerService.server;
  return currentServer.baseUrl;
};
// Receive content shared into the app from the OS share sheet ("Share to
// NotesGraph"). Native passes a `{ text, title? }` payload (title comes from
// EXTRA_SUBJECT — e.g. the article title on Google Feed shares); we create a
// note (bookmark for URLs, paragraph otherwise) in the current workspace and
// open it. Returns false when no workspace is available yet (signed-out cold
// start, mid-login) so the caller can park the payload instead of losing it.
async function handleSharedContent(payload: {
  text?: string;
  title?: string;
}): Promise<boolean> {
  const text = payload?.text;
  if (!text) {
    return true;
  }
  const globalContextService = frameworkProvider.get(GlobalContextService);
  const currentWorkspaceId =
    globalContextService.globalContext.workspaceId.get();
  const workspacesService = frameworkProvider.get(WorkspacesService);
  const workspaceRef = currentWorkspaceId
    ? workspacesService.openByWorkspaceId(currentWorkspaceId)
    : null;
  if (!workspaceRef) {
    return false;
  }
  const { workspace, dispose: disposeWorkspace } = workspaceRef;
  try {
    const docsService = workspace.scope.get(DocsService);
    const docId = await docsService.createDocFromSharedText(
      text,
      payload?.title
    );
    workspace.scope
      .get(WorkbenchService)
      .workbench.openDoc({ docId, fromTab: 'true' });
  } finally {
    disposeWorkspace();
  }
  return true;
}

// A share that arrives before any workspace exists (not logged in / app still
// booting) is parked here and created as soon as a workspace appears — which
// includes "after the user signs in", even across an app restart triggered by
// the login flow.
const PENDING_SHARE_KEY = 'notesgraph:pendingShare';
const PENDING_SHARE_RETRY_MS = 2000;
const PENDING_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
let pendingShareTimer: ReturnType<typeof setInterval> | null = null;

function drainPendingShare() {
  if (pendingShareTimer) return;
  pendingShareTimer = setInterval(() => {
    let stored: { at?: number; text?: string; title?: string } | null = null;
    try {
      const raw = localStorage.getItem(PENDING_SHARE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    if (!stored?.text || Date.now() - (stored.at ?? 0) > PENDING_SHARE_TTL_MS) {
      localStorage.removeItem(PENDING_SHARE_KEY);
      if (pendingShareTimer) {
        clearInterval(pendingShareTimer);
        pendingShareTimer = null;
      }
      return;
    }
    handleSharedContent(stored)
      .then(created => {
        if (created) {
          localStorage.removeItem(PENDING_SHARE_KEY);
          if (pendingShareTimer) {
            clearInterval(pendingShareTimer);
            pendingShareTimer = null;
          }
        }
      })
      .catch(err => {
        console.error('Failed to create pending shared note', err);
      });
  }, PENDING_SHARE_RETRY_MS);
}

(window as any).notesgraphReceiveShare = (payload: {
  text?: string;
  title?: string;
}) => {
  handleSharedContent(payload)
    .then(created => {
      if (!created) {
        localStorage.setItem(
          PENDING_SHARE_KEY,
          JSON.stringify({ ...payload, at: Date.now() })
        );
        drainPendingShare();
      }
    })
    .catch(err => {
      console.error('Failed to handle shared content', err);
    });
};

// A pending share may be left over from a previous run (e.g. the login flow
// restarted the activity before a workspace existed) — resume draining it.
try {
  if (localStorage.getItem(PENDING_SHARE_KEY)) {
    drainPendingShare();
  }
} catch {
  // localStorage unavailable — nothing to resume
}
(window as any).getCurrentI18nLocale = () => {
  return I18n.language;
};
(window as any).getCurrentWorkspaceId = () => {
  const globalContextService = frameworkProvider.get(GlobalContextService);
  return globalContextService.globalContext.workspaceId.get();
};
(window as any).getCurrentDocId = () => {
  const globalContextService = frameworkProvider.get(GlobalContextService);
  return globalContextService.globalContext.docId.get();
};
(window as any).getCurrentDocContentInMarkdown = async () => {
  const globalContextService = frameworkProvider.get(GlobalContextService);
  const currentWorkspaceId =
    globalContextService.globalContext.workspaceId.get();
  const currentDocId = globalContextService.globalContext.docId.get();
  const workspacesService = frameworkProvider.get(WorkspacesService);
  const workspaceRef = currentWorkspaceId
    ? workspacesService.openByWorkspaceId(currentWorkspaceId)
    : null;
  if (!workspaceRef) {
    return;
  }
  const { workspace, dispose: disposeWorkspace } = workspaceRef;

  const docsService = workspace.scope.get(DocsService);
  const docRef = currentDocId ? docsService.open(currentDocId) : null;
  if (!docRef) {
    return;
  }
  const { doc, release: disposeDoc } = docRef;

  try {
    const blockSuiteDoc = doc.blockSuiteDoc;

    const transformer = blockSuiteDoc.getTransformer([
      docLinkBaseURLMiddleware(blockSuiteDoc.workspace.id),
      titleMiddleware(blockSuiteDoc.workspace.meta.docMetas),
    ]);
    const snapshot = transformer.docToSnapshot(blockSuiteDoc);

    const container = new Container();
    getStoreManager()
      .config.init()
      .value.get('store')
      .forEach(ext => {
        ext.setup(container);
      });
    const provider = container.provider();

    const adapter = new MarkdownAdapter(transformer, provider);
    if (!snapshot) {
      return;
    }

    const markdownResult = await adapter.fromDocSnapshot({
      snapshot,
      assets: transformer.assetsManager,
    });
    return markdownResult.file;
  } finally {
    disposeDoc();
    disposeWorkspace();
  }
};

// setup application lifecycle events, and emit application start event
window.addEventListener('focus', () => {
  frameworkProvider.get(LifecycleService).applicationFocus();
});
frameworkProvider.get(LifecycleService).applicationStart();

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const notifyAuthenticationError = (error: unknown, fallback: string) => {
  console.error(fallback, error);
  notify.error({
    title: I18n['com.notesgraph.auth.toast.title.failed'](),
    message: getErrorMessage(error, fallback),
  });
};

CapacitorApp.addListener('appUrlOpen', ({ url }) => {
  // try to close browser if it's open
  InAppBrowser.close().catch(e => console.error('Failed to close browser', e));

  const urlObj = new URL(url);

  if (urlObj.hostname === 'authentication') {
    const method = urlObj.searchParams.get('method');
    const payload = JSON.parse(urlObj.searchParams.get('payload') ?? 'false');
    const serverBaseUrl = urlObj.searchParams.get('server');

    if (
      !method ||
      (method !== 'magic-link' && method !== 'oauth') ||
      !payload
    ) {
      notifyAuthenticationError(
        new Error('Invalid authentication url'),
        'Invalid authentication url'
      );
      return;
    }

    let authService = frameworkProvider
      .get(DefaultServerService)
      .server.scope.get(AuthService);

    if (serverBaseUrl) {
      const serversService = frameworkProvider.get(ServersService);
      const server = serversService.getServerByBaseUrl(serverBaseUrl);
      if (!server) {
        notifyAuthenticationError(
          new Error(
            `Authentication callback server not found: ${serverBaseUrl}`
          ),
          'Authentication callback server not found'
        );
        return;
      }
      authService = server.scope.get(AuthService);
    }

    if (method === 'oauth') {
      authService
        .signInOauth(payload.code, payload.state, payload.provider)
        .catch(error =>
          notifyAuthenticationError(error, 'Failed to sign in with OAuth')
        );
    } else if (method === 'magic-link') {
      authService
        .signInMagicLink(payload.email, payload.token)
        .catch(error =>
          notifyAuthenticationError(error, 'Failed to sign in with magic link')
        );
    }
  }
}).catch(e => {
  notifyAuthenticationError(e, 'Failed to handle authentication callback');
});

const ThemeProvider = () => {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    StatusBar.setStyle({
      style:
        resolvedTheme === 'dark'
          ? Style.Dark
          : resolvedTheme === 'light'
            ? Style.Light
            : Style.Default,
    }).catch(console.error);
    NotesGraphTheme.onThemeChanged({
      darkMode: resolvedTheme === 'dark',
    }).catch(console.error);
  }, [resolvedTheme]);
  return null;
};

export function App() {
  return (
    <Suspense>
      <FrameworkRoot framework={frameworkProvider}>
        <DebugConsole />
        <I18nProvider>
          <NotesGraphContext store={getCurrentStore()}>
            <ThemeProvider />
            <RouterProvider
              fallbackElement={<AppFallback />}
              router={router}
              future={future}
            />
          </NotesGraphContext>
        </I18nProvider>
      </FrameworkRoot>
    </Suspense>
  );
}

function createStoreManagerClient() {
  const worker = new Worker(getWorkerUrl('nbstore'));
  const { port1: nativeDBApiChannelServer, port2: nativeDBApiChannelClient } =
    new MessageChannel();
  AsyncCall<typeof NbStoreNativeDBApis>(NbStoreNativeDBApis, {
    channel: {
      on(listener) {
        const f = (e: MessageEvent<any>) => {
          listener(e.data);
        };
        nativeDBApiChannelServer.addEventListener('message', f);
        return () => {
          nativeDBApiChannelServer.removeEventListener('message', f);
        };
      },
      send(data) {
        nativeDBApiChannelServer.postMessage(data);
      },
    },
    log: false,
  });
  nativeDBApiChannelServer.start();
  worker.postMessage(
    {
      type: 'native-db-api-channel',
      port: nativeDBApiChannelClient,
    },
    [nativeDBApiChannelClient]
  );

  const { port1: authTokenChannelServer, port2: authTokenChannelClient } =
    new MessageChannel();
  authTokenChannelServer.addEventListener('message', event => {
    const { id, endpoint, write } = event.data as {
      id?: string;
      endpoint?: string;
      write?: string;
    };
    if (!id || !endpoint) return;
    if (write !== undefined) {
      writeEndpointToken(endpoint, write)
        .catch(() => {})
        .then(() => authTokenChannelServer.postMessage({ id, written: true }));
      return;
    }
    readEndpointToken(endpoint)
      .then(token => authTokenChannelServer.postMessage({ id, token }))
      .catch(() => authTokenChannelServer.postMessage({ id, token: null }));
  });
  authTokenChannelServer.start();
  worker.postMessage(
    { type: 'native-auth-token-channel', port: authTokenChannelClient },
    [authTokenChannelClient]
  );
  return new StoreManagerClient(new OpClient(worker));
}
