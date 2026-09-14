import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Vite produces the JS/CJS bundles and the generated `style.css` (the latter
// requires vanilla-extract). Type declarations are emitted separately by
// `tsc --emitDeclarationOnly` (see the package `build` script) — this avoids
// vite-plugin-dts' api-extractor coupling, which breaks in this monorepo.
export default defineConfig({
  build: {
    terserOptions: {
      ecma: 2020,
    },
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        css: resolve(__dirname, 'src/index.css.ts'),
        'v2/index': resolve(__dirname, 'src/v2/index.ts'),
        'presets/typography': resolve(
          __dirname,
          'src/presets/typography.css.ts'
        ),
      },
      name: 'ToEverythingTheme',
    },
  },
  plugins: [vanillaExtractPlugin()],
});
