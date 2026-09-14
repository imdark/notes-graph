import { interBoldBase64, interRegularBase64 } from './fonts-data';

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

let cache: SatoriFont[] | null = null;

/**
 * Satori has no system-font access, so we bundle Inter (regular + bold). The
 * fonts are inlined as base64 (see `fonts-data.ts`) so this works whether the
 * package runs from source (sidecar) or bundled (Electron main).
 */
export async function loadFonts(): Promise<SatoriFont[]> {
  if (cache) return cache;
  cache = [
    {
      name: 'Inter',
      data: Buffer.from(interRegularBase64, 'base64'),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Inter',
      data: Buffer.from(interBoldBase64, 'base64'),
      weight: 700,
      style: 'normal',
    },
  ];
  return cache;
}
