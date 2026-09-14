import satori from 'satori';

import { UA } from './constants';
import { extract } from './extract';
import { loadFonts } from './fonts';
import { cardMarkup } from './template';
import type { LinkPreview, RenderCardOptions } from './types';

// sharp and @resvg/resvg-js are native modules. They're loaded lazily (on the
// first render) rather than at import time so that merely importing this module
// — as the Electron main process does, bundling it in — doesn't require the
// native binaries at startup. In a packaged Electron build those binaries may
// be absent (forge's asar packaging drops node_modules), so the require would
// otherwise crash the whole app on launch; here it only fails the render.
let nativesPromise:
  | Promise<{
      sharp: typeof import('sharp').default;
      Resvg: typeof import('@resvg/resvg-js').Resvg;
    }>
  | undefined;
function loadNatives() {
  if (!nativesPromise) {
    nativesPromise = (async () => {
      const [sharpMod, resvgMod] = await Promise.all([
        import('sharp'),
        import('@resvg/resvg-js'),
      ]);
      const sharp = sharpMod.default;
      sharp.cache(false); // don't retain libvips buffers between renders
      return { sharp, Resvg: resvgMod.Resvg };
    })();
  }
  return nativesPromise;
}

const DEFAULT_ACCENT = '#2563eb';

/** Dark text on light accents, white otherwise (perceptual luminance). */
function readableText(r: number, g: number, b: number): string {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#0f172a' : '#ffffff';
}

async function fetchImage(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = 12000
): Promise<Buffer | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Browserless card render from already-extracted metadata: Satori → resvg →
 * sharp. Network (hero/icon fetch) is injected via `opts.fetch`.
 */
export async function renderCardFromPreview(
  data: LinkPreview,
  opts: RenderCardOptions = {}
): Promise<Buffer> {
  const { sharp, Resvg } = await loadNatives();
  const fetchImpl = opts.fetch ?? fetch;

  let heroDataUri: string | undefined;
  let accent = DEFAULT_ACCENT;
  let accentText = '#ffffff';
  if (data.image) {
    const hero = await fetchImage(data.image, fetchImpl);
    if (hero) {
      try {
        const resized = await sharp(hero)
          .resize(480, 630, { fit: 'cover' })
          .jpeg({ quality: 82 })
          .toBuffer();
        heroDataUri = `data:image/jpeg;base64,${resized.toString('base64')}`;
        const { dominant } = await sharp(hero).stats();
        const lum =
          0.2126 * dominant.r + 0.7152 * dominant.g + 0.0722 * dominant.b;
        if (lum > 210) {
          accent = DEFAULT_ACCENT;
          accentText = '#ffffff';
        } else {
          accent = `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`;
          accentText = readableText(dominant.r, dominant.g, dominant.b);
        }
      } catch {
        // unsupported/broken image — skip hero, keep default accent
      }
    }
  }

  let iconDataUri: string | undefined;
  if (data.icon) {
    const icon = await fetchImage(data.icon, fetchImpl);
    if (icon) {
      try {
        const png = await sharp(icon)
          .resize(56, 56, { fit: 'cover' })
          .png()
          .toBuffer();
        iconDataUri = `data:image/png;base64,${png.toString('base64')}`;
      } catch {
        // e.g. .ico not decodable by sharp → fall back to letter avatar
      }
    }
  }

  const fonts = await loadFonts();
  const markup = cardMarkup({
    ...data,
    heroDataUri,
    iconDataUri,
    accent,
    accentText,
  });
  const svg = await satori(markup as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts,
  });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  })
    .render()
    .asPng();
  return await sharp(png)
    .jpeg({ quality: opts.quality ?? 88, mozjpeg: true })
    .toBuffer();
}

/** Extract then render the card. No browser unless `opts.renderHtml` is used. */
export async function renderCard(
  url: string,
  opts: RenderCardOptions = {}
): Promise<Buffer> {
  const data = await extract(url, opts);
  return renderCardFromPreview(data, opts);
}
