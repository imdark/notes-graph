import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  type IpcMainInvokeEvent,
  screen,
} from 'electron';

import { mainWindowOrigin } from '../../shared/internal-origin';
import { ensureHelperProcess } from '../helper-process';
import { logger } from '../logger';
import { buildWebPreferences } from '../web-preferences';
import {
  getMainWindow,
  getTabViewsMeta,
  launchStage,
} from '../windows-manager';

export const QUICK_ASK_SHORTCUT = 'CommandOrControl+Shift+Space';
// Command+Shift+M would take mute from call apps; Control+Option+Space is free.
export const QUICK_CAPTURE_SHORTCUT = 'Control+Alt+Space';

const QUICK_WINDOW_WIDTH = 480;
const QUICK_WINDOW_HEIGHT = 640;
const MAX_PROMPT_LENGTH = 4000;

/**
 * The small always-on-top windows over the workspace: Quick Ask (a chat
 * seeded from the clipboard) and Capture (an idea into the Inbox). Each kind
 * keeps its own window, so opening one doesn't drop what is in the other.
 */
type QuickWindowKind = 'ask' | 'capture';

const quickWindowConfig = {
  ask: { name: 'quick-ask', title: 'Quick ask', path: 'chat' },
  capture: { name: 'quick-capture', title: 'Capture', path: 'capture' },
} satisfies Record<
  QuickWindowKind,
  { name: string; title: string; path: string }
>;

const quickWindows: Partial<
  Record<QuickWindowKind, { window: BrowserWindow; loadedUrl?: string }>
> = {};

async function getAdditionalArguments(kind: QuickWindowKind) {
  const { getExposedMeta } = await import('../exposed');
  const mainExposedMeta = getExposedMeta();
  const helperProcessManager = await ensureHelperProcess();
  const helperExposedMeta = await helperProcessManager.rpc?.getMeta();
  return [
    `--main-exposed-meta=` + JSON.stringify(mainExposedMeta),
    `--helper-exposed-meta=` + JSON.stringify(helperExposedMeta),
    `--window-name=${quickWindowConfig[kind].name}`,
  ];
}

// The active tab's basename is `/workspace/<id>`; it is persisted, so it still
// points at the last workspace when the main window has not loaded a tab yet.
function getCurrentWorkspaceBasename() {
  const meta = getTabViewsMeta();
  const activeId = meta.activeWorkbenchId ?? meta.workbenches.at(0)?.id;
  const workbench =
    meta.workbenches.find(w => w.id === activeId) ??
    meta.workbenches.find(w => w.basename.startsWith('/workspace/'));
  const basename = workbench?.basename;
  return basename?.startsWith('/workspace/') ? basename : undefined;
}

// `quick=1` drops the tabs and sidebar (see core/src/utils/quick-ask.ts).
function buildQuickWindowUrl(
  kind: QuickWindowKind,
  basename: string,
  prompt?: string
) {
  const url = new URL(
    `${basename}/${quickWindowConfig[kind].path}`,
    mainWindowOrigin
  );
  url.searchParams.set('quick', '1');
  if (prompt) {
    url.searchParams.set('prompt', prompt);
  }
  return url.href;
}

async function createQuickWindow(kind: QuickWindowKind) {
  const helperProcessManager = await ensureHelperProcess();
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);

  const width = Math.min(workArea.width, QUICK_WINDOW_WIDTH);
  const height = Math.min(workArea.height, QUICK_WINDOW_HEIGHT);

  const browserWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 3),
    minWidth: 360,
    minHeight: 400,
    alwaysOnTop: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: quickWindowConfig[kind].title,
    webPreferences: buildWebPreferences({
      webgl: true,
      preload: join(__dirname, './preload.js'),
      additionalArguments: await getAdditionalArguments(kind),
    }),
  });

  let disconnectHelperProcess: (() => void) | null = null;
  browserWindow.webContents.on('did-finish-load', () => {
    disconnectHelperProcess?.();
    disconnectHelperProcess = helperProcessManager.connectRenderer(
      browserWindow.webContents
    );
  });
  browserWindow.once('ready-to-show', () => {
    browserWindow.show();
    browserWindow.focus();
  });
  browserWindow.on('closed', () => {
    disconnectHelperProcess?.();
    disconnectHelperProcess = null;
    delete quickWindows[kind];
  });

  return browserWindow;
}

async function openQuickWindow(kind: QuickWindowKind) {
  const basename =
    launchStage.value === 'main' ? getCurrentWorkspaceBasename() : undefined;
  if (!basename) {
    logger.info(`quick ${kind}: no workspace yet, showing main window`);
    const mainWindow = await getMainWindow();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const prompt =
    kind === 'ask'
      ? clipboard.readText().trim().slice(0, MAX_PROMPT_LENGTH)
      : undefined;
  const url = buildQuickWindowUrl(kind, basename, prompt);

  let entry = quickWindows[kind];
  if (!entry || entry.window.isDestroyed()) {
    entry = { window: await createQuickWindow(kind) };
    quickWindows[kind] = entry;
  }
  const win = entry.window;

  // Reloading drops an in-progress chat or capture, so only navigate when the
  // clipboard or workspace changed since the last open.
  if (url !== entry.loadedUrl) {
    entry.loadedUrl = url;
    logger.info(`quick ${kind}: loading`, basename);
    win
      .loadURL(url)
      .catch(err => logger.error(`quick ${kind}: load failed`, err));
  }

  if (win.isMinimized()) {
    win.restore();
  }
  if (win.webContents.getURL()) {
    win.show();
    win.focus();
  }
}

export function openQuickAsk() {
  return openQuickWindow('ask');
}

export function openQuickCapture() {
  return openQuickWindow('capture');
}

export async function hideQuickAsk(e: IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && Object.values(quickWindows).some(q => q.window === win)) {
    win.hide();
  }
}

function registerShortcut(accelerator: string, open: () => Promise<void>) {
  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, () => {
      open().catch(err => logger.error('quick window: open failed', err));
    });
  } catch (err) {
    logger.error('quick window: shortcut registration threw', err);
  }
  if (registered) {
    logger.info('quick window: registered', accelerator);
  } else {
    logger.warn(
      'quick window: could not register shortcut (taken by another app?)',
      accelerator
    );
  }
  app.on('will-quit', () => {
    globalShortcut.unregister(accelerator);
  });
}

export function registerQuickAskShortcut() {
  registerShortcut(QUICK_ASK_SHORTCUT, openQuickAsk);
  registerShortcut(QUICK_CAPTURE_SHORTCUT, openQuickCapture);
}
