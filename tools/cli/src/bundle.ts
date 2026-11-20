import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Logger } from '@notesgraph-tools/utils/logger';
import { Package } from '@notesgraph-tools/utils/workspace';
import rspack, { type MultiRspackOptions } from '@rspack/core';
import {
  type Configuration as RspackDevServerConfiguration,
  RspackDevServer,
} from '@rspack/dev-server';
import { merge } from 'lodash-es';

import {
  assertRspackSupportedPackageName,
  DEFAULT_DEV_SERVER_CONFIG,
} from './bundle-shared';
import { Option, PackageCommand } from './command';
import {
  createHTMLTargetConfig as createRspackHTMLTargetConfig,
  createNodeTargetConfig as createRspackNodeTargetConfig,
  createWorkerTargetConfig as createRspackWorkerTargetConfig,
  getBuildConfigFromEnv,
} from './rspack';
import {
  shouldUploadReleaseAssets,
  uploadDistAssetsToS3,
} from './rspack-shared/s3-plugin.js';

type WorkerConfig = { name: string };
type CreateWorkerTargetConfig = (pkg: Package, entry: string) => WorkerConfig;
type BaseWorkerOptions = {
  includeMermaidAndTypst?: boolean;
};

function assertRspackSupportedPackage(pkg: Package) {
  assertRspackSupportedPackageName(pkg.name);
}

function shouldUploadAssetsForPackage(pkg: Package): boolean {
  return (
    !!process.env.R2_SECRET_ACCESS_KEY && shouldUploadReleaseAssets(pkg.name)
  );
}

async function uploadAssetsForPackage(pkg: Package, logger: Logger) {
  if (!shouldUploadAssetsForPackage(pkg)) {
    return;
  }
  logger.info('Uploading dist assets to R2...');
  await uploadDistAssetsToS3(pkg.distPath.value);
  logger.info('Uploaded dist assets to R2.');
}

function getBaseWorkerConfigs(
  pkg: Package,
  createWorkerTargetConfig: CreateWorkerTargetConfig,
  options: BaseWorkerOptions = {}
) {
  const core = new Package('@notesgraph/core');
  const includeMermaidAndTypst = options.includeMermaidAndTypst ?? true;

  const workerConfigs = [
    createWorkerTargetConfig(
      pkg,
      core.srcPath.join(
        'modules/workspace-engine/impls/workspace-profile.worker.ts'
      ).value
    ),
    createWorkerTargetConfig(
      pkg,
      core.srcPath.join('modules/pdf/renderer/pdf.worker.ts').value
    ),
    createWorkerTargetConfig(
      pkg,
      core.srcPath.join(
        'blocksuite/view-extensions/turbo-renderer/turbo-painter.worker.ts'
      ).value
    ),
    createWorkerTargetConfig(
      pkg,
      core.srcPath.join('modules/ai-local/services/go-board-ocr.worker.ts')
        .value
    ),
  ];

  if (includeMermaidAndTypst) {
    workerConfigs.push(
      createWorkerTargetConfig(
        pkg,
        core.srcPath.join('modules/mermaid/renderer/mermaid.worker.ts').value
      ),
      createWorkerTargetConfig(
        pkg,
        core.srcPath.join('modules/typst/renderer/typst.worker.ts').value
      )
    );
  }

  return workerConfigs;
}

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SRC_DIR, '..', '..', '..');

/**
 * Keep rspack's module cache between production builds, in
 * NOTESGRAPH_RSPACK_CACHE_DIR (deploy-prod.yml restores and saves it; unset,
 * nothing changes). Each config of the multi-build gets its own folder.
 *
 * Invalidation: `version` hashes the package, NODE_ENV, the whole build
 * config (the values DefinePlugin bakes into modules, BUILD_CONFIG.*) and the
 * contents of the bundler config code and yarn.lock, so any of those
 * changing starts a separate cache instead of reusing modules compiled the
 * old way. That is done here rather than with buildDependencies, which
 * follows imports and can't resolve these TS sources' `.js` specifiers.
 * `portable` keeps the cache valid at another checkout path.
 *
 * Measured locally on @notesgraph/web: 11.5 s compile cold, 1.5 s warm, and
 * the warm build's 1094 files identical to an uncached build's.
 */
function usePersistentCache(pkg: Package, configs: MultiRspackOptions) {
  const dir = process.env.NOTESGRAPH_RSPACK_CACHE_DIR;
  if (!dir) return;
  const sharedDir = join(SRC_DIR, 'rspack-shared');
  const toolFiles = [
    join(SRC_DIR, 'bundle.ts'),
    join(SRC_DIR, 'rspack', 'index.ts'),
    ...readdirSync(sharedDir)
      .sort()
      .map(file => join(sharedDir, file)),
    join(ROOT_DIR, 'yarn.lock'),
  ];
  const hash = createHash('sha256').update(
    JSON.stringify({
      pkg: pkg.name,
      env: process.env.NODE_ENV,
      build: getBuildConfigFromEnv(pkg),
    })
  );
  for (const file of toolFiles) hash.update(readFileSync(file));
  const version = hash.digest('hex').slice(0, 16);
  configs.forEach((config, i) => {
    // Config names are entry paths: keep them relative, so the folder is the
    // same in any checkout.
    const name = String(config.name ?? i)
      .replace(ROOT_DIR, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_');
    config.cache = {
      type: 'persistent',
      version,
      portable: true,
      storage: {
        type: 'filesystem',
        directory: join(dir, pkg.name.replace('@notesgraph/', ''), name),
      },
    };
  });
}

function getRspackBundleConfigs(pkg: Package): MultiRspackOptions {
  assertRspackSupportedPackage(pkg);

  switch (pkg.name) {
    case '@notesgraph/admin': {
      return [
        createRspackHTMLTargetConfig(pkg, pkg.srcPath.join('index.tsx').value, {
          selfhostPublicPath: '/admin/',
        }),
      ] as MultiRspackOptions;
    }
    case '@notesgraph/web':
    case '@notesgraph/mobile': {
      const workerConfigs = getBaseWorkerConfigs(
        pkg,
        createRspackWorkerTargetConfig
      );
      workerConfigs.push(
        createRspackWorkerTargetConfig(
          pkg,
          pkg.srcPath.join('nbstore.worker.ts').value
        )
      );

      return [
        createRspackHTMLTargetConfig(
          pkg,
          pkg.srcPath.join('index.tsx').value,
          {},
          workerConfigs.map(config => config.name)
        ),
        ...workerConfigs,
      ] as MultiRspackOptions;
    }
    case '@notesgraph/ios':
    case '@notesgraph/android': {
      const workerConfigs = getBaseWorkerConfigs(
        pkg,
        createRspackWorkerTargetConfig,
        { includeMermaidAndTypst: false }
      );
      workerConfigs.push(
        createRspackWorkerTargetConfig(
          pkg,
          pkg.srcPath.join('nbstore.worker.ts').value
        )
      );

      return [
        createRspackHTMLTargetConfig(
          pkg,
          pkg.srcPath.join('index.tsx').value,
          {},
          workerConfigs.map(config => config.name)
        ),
        ...workerConfigs,
      ] as MultiRspackOptions;
    }
    case '@notesgraph/electron-renderer': {
      const workerConfigs = getBaseWorkerConfigs(
        pkg,
        createRspackWorkerTargetConfig,
        { includeMermaidAndTypst: false }
      );

      return [
        createRspackHTMLTargetConfig(
          pkg,
          {
            index: pkg.srcPath.join('app/index.tsx').value,
            shell: pkg.srcPath.join('shell/index.tsx').value,
            popup: pkg.srcPath.join('popup/index.tsx').value,
            backgroundWorker: pkg.srcPath.join('background-worker/index.ts')
              .value,
          },
          {
            additionalEntryForSelfhost: false,
            injectGlobalErrorHandler: false,
            emitAssetsManifest: false,
          },
          workerConfigs.map(config => config.name)
        ),
        ...workerConfigs,
      ] as MultiRspackOptions;
    }
    case '@notesgraph/server': {
      return [
        createRspackNodeTargetConfig(pkg, pkg.srcPath.join('index.ts').value),
      ] as MultiRspackOptions;
    }
    case '@notesgraph/reader': {
      return [
        createRspackNodeTargetConfig(pkg, pkg.srcPath.join('index.ts').value, {
          outputFilename: 'index.js',
          decoratorVersion: '2022-03',
          libraryType: 'module',
          bundleAllDependencies: true,
          forceExternal: ['yjs'],
        }),
      ] as MultiRspackOptions;
    }
    case '@notesgraph/media-capture-playground': {
      return [
        createRspackHTMLTargetConfig(pkg, pkg.join('web/main.tsx').value, {
          template: pkg.join('web/index.html').value,
          additionalEntryForSelfhost: false,
          copySharedPublicAssets: false,
          injectGlobalErrorHandler: false,
          emitAssetsManifest: false,
        }),
      ] as MultiRspackOptions;
    }
  }

  throw new Error(`Unsupported package: ${pkg.name}`);
}

function getRspackDevServerConfig(
  pkg: Package
): RspackDevServerConfiguration | undefined {
  if (pkg.name !== '@notesgraph/media-capture-playground') {
    return;
  }

  return {
    proxy: [
      {
        context: '/api',
        target: 'http://localhost:6544',
        changeOrigin: true,
        pathRewrite: { '^/api': '' },
      },
    ],
  };
}

export class BundleCommand extends PackageCommand {
  static override paths = [['bundle'], ['pack'], ['bun']];

  // bundle is not able to run with deps
  override _deps = false;
  override waitDeps = false;

  dev = Option.Boolean('--dev,-d', false, {
    description: 'Run in Development mode',
  });

  async execute() {
    const pkg = this.workspace.getPackage(this.package);

    if (this.dev) {
      await BundleCommand.dev(pkg, getRspackDevServerConfig(pkg));
    } else {
      await BundleCommand.build(pkg);
    }
  }

  static async build(pkg: Package) {
    return BundleCommand.buildWithRspack(pkg);
  }

  static async dev(
    pkg: Package,
    devServerConfig?: RspackDevServerConfiguration
  ) {
    return BundleCommand.devWithRspack(pkg, devServerConfig);
  }

  static async buildWithRspack(pkg: Package) {
    process.env.NODE_ENV = 'production';
    assertRspackSupportedPackage(pkg);

    const logger = new Logger('bundle');
    logger.info(`Packing package ${pkg.name} with rspack...`);
    logger.info('Cleaning old output...');
    rmSync(pkg.distPath.value, { recursive: true, force: true });

    const config = getRspackBundleConfigs(pkg);
    config.parallelism = cpus().length;
    usePersistentCache(pkg, config);

    const compiler = rspack(config);
    if (!compiler) {
      throw new Error('Failed to create rspack compiler');
    }

    try {
      const stats = await new Promise<any>((resolve, reject) => {
        compiler.run((error, stats) => {
          if (error) {
            reject(error);
            return;
          }
          if (!stats) {
            reject(new Error('Failed to get rspack stats'));
            return;
          }
          resolve(stats);
        });
      });
      if (stats.hasErrors()) {
        console.error(stats.toString('errors-only'));
        process.exit(1);
        return;
      }
      console.log(stats.toString('minimal'));
      if (process.env.NG_STATS) {
        const fs = await import('node:fs');
        const json = stats.toJson({
          modules: false,
          chunks: true,
          chunkModules: true,
          reasons: false,
          source: false,
        });
        fs.writeFileSync(process.env.NG_STATS, JSON.stringify(json));
        console.log(`[NG_STATS] wrote stats to ${process.env.NG_STATS}`);
      }
      await uploadAssetsForPackage(pkg, logger);
    } catch (error) {
      console.error(error);
      process.exit(1);
      return;
    }
  }

  static async devWithRspack(
    pkg: Package,
    devServerConfig?: RspackDevServerConfiguration
  ) {
    process.env.NODE_ENV = 'development';
    assertRspackSupportedPackage(pkg);

    const logger = new Logger('bundle');
    logger.info(`Starting rspack dev server for ${pkg.name}...`);

    const config = getRspackBundleConfigs(pkg);
    config.parallelism = cpus().length;

    const compiler = rspack(config);
    if (!compiler) {
      throw new Error('Failed to create rspack compiler');
    }

    const serverConfig = merge({}, DEFAULT_DEV_SERVER_CONFIG, devServerConfig);
    if (devServerConfig?.proxy) {
      serverConfig.proxy = devServerConfig.proxy;
    }

    const devServer = new RspackDevServer(serverConfig, compiler);

    await devServer.start();
  }
}
