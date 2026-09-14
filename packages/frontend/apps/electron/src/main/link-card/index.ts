import {
  type ClipMode,
  extract,
  fetchFaviconDataUrl,
  isEmbeddable,
  renderCardFromPreview,
} from '@notesgraph/link-card';
import { BrowserWindow } from 'electron';

import type { NamespaceHandlers } from '../type';

/** Faithful screenshot via a hidden offscreen window (Electron's own Chromium). */
async function screenshot(url: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { offscreen: true, sandbox: true },
  });
  try {
    await win.loadURL(url);
    // give lazy images / web fonts a moment to settle
    await new Promise(resolve => setTimeout(resolve, 800));
    const image = await win.webContents.capturePage();
    return image.toJPEG(82);
  } finally {
    win.destroy();
  }
}

function toDataUrl(buffer: Buffer, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Desktop host for the link-card renderer: crawl + render in the Electron main
 * process, with no external service. Cards come back as data URLs so they
 * persist in the doc and need no image proxy.
 */
export const linkCardHandlers = {
  getPreview: async (_, url: string) => {
    const meta = await extract(url);
    const card = await renderCardFromPreview(meta);
    // Inline the favicon as a data URL so it persists in the doc and works
    // offline (no re-fetch needed).
    const favicon = meta.icon
      ? ((await fetchFaviconDataUrl(meta.icon)) ?? meta.icon)
      : undefined;
    return {
      url: meta.url,
      title: meta.title,
      siteName: meta.siteName,
      description: meta.excerpt,
      images: [toDataUrl(card), ...(meta.image ? [meta.image] : [])],
      favicons: favicon ? [favicon] : [],
      mediaType: 'text/html',
    };
  },
  getImage: async (_, url: string, mode: ClipMode) => {
    if (mode === 'screenshot') {
      return toDataUrl(await screenshot(url));
    }
    const meta = await extract(url);
    return toDataUrl(await renderCardFromPreview(meta));
  },
  isEmbeddable: async (_, url: string) => {
    return isEmbeddable(url);
  },
} satisfies NamespaceHandlers;
