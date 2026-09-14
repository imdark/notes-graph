import { type ChildProcess } from 'node:child_process';
import net from 'node:net';

import type { PackageName } from '@notesgraph-tools/utils/workspace';

import { Option, PackageSelectorCommand } from './command';

/** Local sidecars the web app talks to during development. */
const WEB_SIDECARS = [
  { pkg: '@notesgraph/link-card-server', port: 8088, label: 'link-card' },
  { pkg: '@notesgraph/plugin-server', port: 8099, label: 'plugins' },
  {
    pkg: '@notesgraph/uppy-companion-server',
    port: 3020,
    label: 'uppy-companion',
    // Companion errors out if a configured provider is missing its
    // key/secret, so only start it once at least one is actually set up.
    enabled: () =>
      !!(process.env.COMPANION_GOOGLE_KEY || process.env.COMPANION_DROPBOX_KEY),
  },
] as const;

/** Resolves true if something is already listening on the port. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export class DevCommand extends PackageSelectorCommand {
  static override paths = [['dev'], ['d']];

  protected override availablePackages: PackageName[] = [
    '@notesgraph/web',
    '@notesgraph/server',
    '@notesgraph/electron',
    '@notesgraph/electron-renderer',
    '@notesgraph/mobile',
    '@notesgraph/ios',
    '@notesgraph/android',
    '@notesgraph/admin',
  ];

  protected deps = Option.Boolean('--deps', {
    description: 'Run dev with dependencies',
  });

  async execute() {
    const name = await this.getPackage();
    const args = [];

    if (this.deps) {
      args.push('--deps');
    }

    args.push(name, 'dev');

    // The web app relies on local sidecars (link cards / screenshots on :8088,
    // plugin marketplace on :8099). Start them alongside the web dev server so
    // `yarn dev -p web` is self-contained; skip any already running.
    const sidecars =
      name === '@notesgraph/web' ? await this.startWebSidecars() : [];

    try {
      await this.cli.run(args);
    } finally {
      for (const child of sidecars) child.kill();
    }
  }

  private async startWebSidecars(): Promise<ChildProcess[]> {
    const children: ChildProcess[] = [];
    for (const sidecar of WEB_SIDECARS) {
      const { pkg, port, label } = sidecar;
      if ('enabled' in sidecar && !sidecar.enabled()) {
        this.logger.info(`${label} sidecar not configured — skipping`);
        continue;
      }
      if (await isPortInUse(port)) {
        this.logger.info(
          `${label} sidecar already running on :${port} — skipping`
        );
        continue;
      }
      children.push(this.spawn(['yarn', 'workspace', pkg, 'start']));
    }
    return children;
  }
}
