import type { Configuration as RspackDevServerConfiguration } from '@rspack/dev-server';

export const RSPACK_SUPPORTED_PACKAGES = [
  '@notesgraph/admin',
  '@notesgraph/web',
  '@notesgraph/mobile',
  '@notesgraph/ios',
  '@notesgraph/android',
  '@notesgraph/electron-renderer',
  '@notesgraph/server',
  '@notesgraph/reader',
  '@notesgraph/media-capture-playground',
] as const;

const rspackSupportedPackageSet = new Set<string>(RSPACK_SUPPORTED_PACKAGES);

export function isRspackSupportedPackageName(name: string) {
  return rspackSupportedPackageSet.has(name);
}

export function assertRspackSupportedPackageName(name: string) {
  if (isRspackSupportedPackageName(name)) {
    return;
  }

  throw new Error(
    `Rspack bundling currently supports: ${Array.from(RSPACK_SUPPORTED_PACKAGES).join(', ')}. Unsupported package: ${name}.`
  );
}

// Served instead of the real offline-shell sw.js (frontend/core/public) in
// dev. A service worker left over from a production visit — or an earlier
// dev session — serves stale bundles cache-first, and the stale bundle's
// live-reload client then sees a compilation-hash mismatch and reloads
// forever. Browsers re-fetch the SW script on navigation bypassing both the
// worker and its caches, so serving different bytes here reaches even a
// reload-looping tab: the kill-switch installs, wipes caches, unregisters,
// and reloads its clients clean.
const SW_KILLSWITCH = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.navigate(client.url));
  })());
});
`;

export const DEFAULT_DEV_SERVER_CONFIG: RspackDevServerConfiguration = {
  host: '0.0.0.0',
  allowedHosts: 'all',
  hot: false,
  liveReload: true,
  setupMiddlewares: middlewares => {
    middlewares.unshift({
      name: 'sw-killswitch',
      path: '/sw.js',
      middleware: (_req: unknown, res: any) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(SW_KILLSWITCH);
      },
    });
    return middlewares;
  },
  compress: !process.env.CI,
  setupExitSignals: true,
  client: {
    overlay: process.env.DISABLE_DEV_OVERLAY === 'true' ? false : undefined,
    logging: process.env.CI ? 'none' : 'error',
    // see: https://webpack.js.org/configuration/dev-server/#websocketurl
    // must be an explicit ws/wss URL because custom protocols (e.g. assets://)
    // cannot be used to construct WebSocket endpoints in Electron
    webSocketURL: 'ws://0.0.0.0:8080/ws',
  },
  historyApiFallback: {
    rewrites: [
      {
        from: /.*/,
        to: () => {
          return process.env.SELF_HOSTED === 'true'
            ? '/selfhost.html'
            : '/index.html';
        },
      },
    ],
  },
  proxy: [
    {
      context: '/api',
      target: 'http://localhost:3010',
    },
    {
      context: '/socket.io',
      target: 'http://localhost:3010',
      ws: true,
    },
    {
      context: '/graphql',
      target: 'http://localhost:3010',
    },
  ],
};
