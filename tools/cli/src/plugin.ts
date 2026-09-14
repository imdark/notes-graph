import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import { Command, Option } from './command';

const DEFAULT_REGISTRY =
  process.env.NOTESGRAPH_PLUGIN_REGISTRY ?? 'http://localhost:8099';

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

interface PluginManifestLite {
  entry?: { client?: string; server?: string };
}

function replacePlaceholders(dir: string, id: string, name: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      replacePlaceholders(full, id, name);
    } else {
      const content = readFileSync(full, 'utf8');
      if (content.includes('__PLUGIN_')) {
        writeFileSync(
          full,
          content
            .replaceAll('__PLUGIN_ID__', id)
            .replaceAll('__PLUGIN_NAME__', name)
        );
      }
    }
  }
}

function maybeBuild(root: string, log: (message: string) => void) {
  if (existsSync(join(root, 'build.mjs'))) {
    execSync('node build.mjs', { cwd: root, stdio: 'inherit' });
  } else {
    log('no build.mjs — skipping build');
  }
}

function readManifest(root: string): PluginManifestLite {
  return JSON.parse(
    readFileSync(join(root, 'manifest.json'), 'utf8')
  ) as PluginManifestLite;
}

export class PluginCreateCommand extends Command {
  static override paths = [['plugin', 'create']];
  name = Option.String();
  dir = Option.String({ required: false });

  async execute() {
    const target = resolve(this.dir ?? join(process.cwd(), this.name));
    if (existsSync(target)) {
      this.logger.info(`error: ${target} already exists`);
      return 1;
    }
    const template = this.workspace.join(
      'tools/plugin-template/template'
    ).value;
    cpSync(template, target, { recursive: true });
    const id = this.name.includes('.') ? this.name : `com.example.${this.name}`;
    replacePlaceholders(target, id, this.name);
    this.logger.info(`Created plugin "${this.name}" at ${target}`);
    this.logger.info('Next: install deps, then `notesgraph plugin dev`');
    return 0;
  }
}

export class PluginBuildCommand extends Command {
  static override paths = [['plugin', 'build']];
  dir = Option.String({ required: false });

  async execute() {
    maybeBuild(resolve(this.dir ?? process.cwd()), m => this.logger.info(m));
    this.logger.info('Done.');
  }
}

export class PluginDevCommand extends Command {
  static override paths = [['plugin', 'dev']];
  dir = Option.String({ required: false });
  port = Option.String('--port,-p', '5999');

  async execute() {
    const root = resolve(this.dir ?? process.cwd());
    maybeBuild(root, m => this.logger.info(m));
    const server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const file = join(root, path);
      if (
        !file.startsWith(root) ||
        !existsSync(file) ||
        statSync(file).isDirectory()
      ) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      res.end(readFileSync(file));
    });
    const port = Number(this.port);
    server.listen(port, () =>
      this.logger.info(
        `Dev server: http://localhost:${port} — load this URL in NotesGraph → Settings → Plugins`
      )
    );
    await new Promise<void>(() => {});
  }
}

export class PluginPublishCommand extends Command {
  static override paths = [['plugin', 'publish']];
  dir = Option.String({ required: false });
  registry = Option.String('--registry', DEFAULT_REGISTRY);

  async execute() {
    const root = resolve(this.dir ?? process.cwd());
    maybeBuild(root, m => this.logger.info(m));
    const manifest = readManifest(root);
    const files: Record<string, string> = {};
    for (const rel of [manifest.entry?.client, manifest.entry?.server]) {
      if (rel) files[rel] = readFileSync(join(root, rel), 'utf8');
    }
    const res = await fetch(`${this.registry}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest, files }),
    });
    this.logger.info(`${res.status}: ${await res.text()}`);
    return res.ok ? 0 : 1;
  }
}
