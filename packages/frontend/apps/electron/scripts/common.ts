import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBuildConfig } from '@notesgraph-tools/utils/build-config';
import { Package } from '@notesgraph-tools/utils/workspace';
import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';
import type { BuildOptions, Plugin } from 'esbuild';

export const electronDir = fileURLToPath(new URL('..', import.meta.url));

export const rootDir = resolve(electronDir, '..', '..', '..', '..');

export const NODE_MAJOR_VERSION = 22;

export const mode = (process.env.NODE_ENV =
  process.env.NODE_ENV || 'development');

export const config = (): BuildOptions => {
  const define = {
    'process.env.GITHUB_SHA': process.env.GITHUB_SHA,
    'process.env.SENTRY_RELEASE': process.env.SENTRY_RELEASE,
    'process.env.SENTRY_DSN': process.env.SENTRY_DSN,
    'process.env.DEV_SERVER_URL': process.env.DEV_SERVER_URL,
    'process.env.NODE_ENV': process.env.NODE_ENV,
    REPLACE_ME_BUILD_ENV: process.env.BUILD_TYPE ?? 'stable',
    ...Object.entries(
      getBuildConfig(new Package('@notesgraph/electron'), {
        mode:
          process.env.NODE_ENV === 'production' ? 'production' : 'development',
        channel: (process.env.BUILD_TYPE as any) ?? 'canary',
      })
    ).reduce(
      (def, [key, val]) => {
        def[`BUILD_CONFIG.${key}`] = val;
        return def;
      },
      {} as Record<string, any>
    ),
  };

  const plugins: Plugin[] = [];

  if (
    process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT
  ) {
    plugins.push(
      sentryEsbuildPlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
      })
    );
  }

  plugins.push({
    name: 'no-side-effects',
    setup(build) {
      build.onResolve({ filter: /\.js/ }, async args => {
        if (args.pluginData) return; // Ignore this if we called ourselves

        const { path, ...rest } = args;

        // mark all blocksuite packages as side-effect free
        // because they will include a lot of files that are not used in node_modules
        if (rest.resolveDir.includes('blocksuite')) {
          rest.pluginData = true; // Avoid infinite recursion
          const result = await build.resolve(path, rest);

          result.sideEffects = false;
          return result;
        }
        return null;
      });
    },
  });

  return {
    entryPoints: [
      resolve(electronDir, './src/main/index.ts'),
      resolve(electronDir, './src/preload/index.ts'),
      resolve(electronDir, './src/helper/index.ts'),
    ],
    entryNames: '[dir]',
    outdir: resolve(electronDir, './dist'),
    bundle: true,
    target: `node${NODE_MAJOR_VERSION}`,
    platform: 'node',
    external: [
      'electron',
      // NOTE: electron-updater / semver / yjs are bundled, NOT external.
      // electron-forge's asar packaging leaves the app's node_modules nearly
      // empty (the hoisted tree is symlinked and doesn't survive packaging),
      // so any runtime require of an external pure-JS dep crashed the packaged
      // app on startup (electron-updater was the first). Bundling them inlines
      // them into main.js so no runtime resolution is needed.
      // sharp / @resvg/resvg-js are native (can't be bundled) and are only used
      // lazily by the link-card renderer — kept external; packaging those for
      // the .dmg is a separate follow-up (needs node_modules to ship in asar).
      'sharp',
      '@resvg/resvg-js',
    ],
    format: 'cjs',
    loader: {
      '.node': 'copy',
    },
    define: Object.entries(define).reduce(
      (def, [key, val]) => {
        def[key] =
          JSON.stringify(val) ??
          String(
            val
          ) /* JSON.stringify(undefined) == undefined, but we need 'undefined' */;
        return def;
      },
      {} as Record<string, string>
    ),
    assetNames: '[name]',
    treeShaking: true,
    sourcemap: 'linked',
    plugins,
  };
};
