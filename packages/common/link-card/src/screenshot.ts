import type { Browser } from 'playwright';

import { HIDE_OVERLAYS_CSS, UA } from './constants';

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  fullPage?: boolean;
  scale?: number;
  quality?: number;
  maxWidth?: number;
  timeout?: number;
  hideOverlays?: boolean;
}

let browserPromise: Promise<Browser> | null = null;

/**
 * One warm WebKit instance. `playwright` is imported dynamically so hosts that
 * only render cards never load it. WebKit is the lightest modern engine (no X
 * server, no Chromium). Used by the web sidecar; Electron uses its own window.
 */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import('playwright')
      .then(({ webkit }) => webkit.launch({ headless: true }))
      .catch(err => {
        // Don't cache a failed launch (e.g. WebKit not yet installed) — let the
        // next request retry instead of poisoning the promise permanently.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close();
}

/** Faithful screenshot of the rendered page via headless WebKit → JPEG. */
export async function renderScreenshot(
  url: string,
  opts: ScreenshotOptions = {}
): Promise<Buffer> {
  const {
    width = 1280,
    height = 800,
    fullPage = false,
    scale = 1,
    quality = 82,
    maxWidth,
    timeout = 30000,
    hideOverlays = true,
  } = opts;

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    userAgent: UA,
  });
  const page = await context.newPage();
  try {
    await page
      .goto(url, { waitUntil: 'networkidle', timeout })
      .catch(() => page.goto(url, { waitUntil: 'load', timeout }));
    if (hideOverlays) {
      await page.addStyleTag({ content: HIDE_OVERLAYS_CSS }).catch(() => {});
    }
    await page.waitForTimeout(400);
    const raw = await page.screenshot({ type: 'jpeg', quality, fullPage });

    const { default: sharp } = await import('sharp');
    let img = sharp(raw);
    if (maxWidth)
      img = img.resize({ width: maxWidth, withoutEnlargement: true });
    return await img.jpeg({ quality, mozjpeg: true }).toBuffer();
  } finally {
    await context.close();
  }
}
