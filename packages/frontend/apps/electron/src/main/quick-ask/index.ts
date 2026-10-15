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
export const QUICK_ASK_WINDOW_NAME = 'quick-ask';

const QUICK_ASK_WIDTH = 480;
const QUICK_ASK_HEIGHT = 640;
const MAX_PROMPT_LENGTH = 4000;

let quickAskWindow: BrowserWindow | undefined;
let loadedUrl: string | undefined;

async function getAdditionalArguments() {
  const { getExposedMeta } = await import('../exposed');
  const mainExposedMeta = getExposedMeta();
  const helperProcessManager = await ensureHelperProcess();
  const helperExposedMeta = await helperProcessManager.rpc?.getMeta();
  return [
    `--main-exposed-meta=` + JSON.stringify(mainExposedMeta),
    `--helper-exposed-meta=` + JSON.stringify(helperExposedMeta),
    `--window-name=${QUICK_ASK_WINDOW_NAME}`,
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

function buildQuickAskUrl(basename: string, prompt: string) {
  const url = new URL(`${basename}/chat`, mainWindowOrigin);
  url.searchParams.set('quick', '1');
  if (prompt) {
    url.searchParams.set('prompt', prompt);
  }
  return url.href;
}

async function createQuickAskWindow() {
  const helperProcessManager = await ensureHelperProcess();
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);

  const width = Math.min(workArea.width, QUICK_ASK_WIDTH);
  const height = Math.min(workArea.height, QUICK_ASK_HEIGHT);

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
    title: 'Quick ask',
    webPreferences: buildWebPreferences({
      webgl: true,
      preload: join(__dirname, './preload.js'),
      additionalArguments: await getAdditionalArguments(),
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
    quickAskWindow = undefined;
    loadedUrl = undefined;
  });

  return browserWindow;
}

export async function openQuickAsk() {
  const basename =
    launchStage.value === 'main' ? getCurrentWorkspaceBasename() : undefined;
  if (!basename) {
    logger.info('quick ask: no workspace yet, showing main window');
    const mainWindow = await getMainWindow();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const prompt = clipboard.readText().trim().slice(0, MAX_PROMPT_LENGTH);
  const url = buildQuickAskUrl(basename, prompt);

  if (!quickAskWindow || quickAskWindow.isDestroyed()) {
    quickAskWindow = await createQuickAskWindow();
  }
  const win = quickAskWindow;

  // Reloading drops an in-progress chat, so only navigate when the clipboard
  // or workspace changed since the last open.
  if (url !== loadedUrl) {
    loadedUrl = url;
    logger.info('quick ask: loading', basename);
    win.loadURL(url).catch(err => logger.error('quick ask: load failed', err));
  }

  if (win.isMinimized()) {
    win.restore();
  }
  if (win.webContents.getURL()) {
    win.show();
    win.focus();
  }
}

export async function hideQuickAsk(e: IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win === quickAskWindow) {
    win.hide();
  }
}

export function registerQuickAskShortcut() {
  let registered = false;
  try {
    registered = globalShortcut.register(QUICK_ASK_SHORTCUT, () => {
      openQuickAsk().catch(err => logger.error('quick ask: open failed', err));
    });
  } catch (err) {
    logger.error('quick ask: shortcut registration threw', err);
  }
  if (registered) {
    logger.info('quick ask: registered', QUICK_ASK_SHORTCUT);
  } else {
    logger.warn(
      'quick ask: could not register shortcut (taken by another app?)',
      QUICK_ASK_SHORTCUT
    );
  }

  app.on('will-quit', () => {
    globalShortcut.unregister(QUICK_ASK_SHORTCUT);
  });
}
