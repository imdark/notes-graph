import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Application, Request, Response } from 'express';
import { static as serveStatic } from 'express';
import isMobile from 'is-mobile';

import { Config } from '../../base';
import { SetupMiddleware } from './setup';

// Content-hashed bundle dirs — their URL changes with their bytes, so both the
// asset and its pre-built `.br`/`.gz` (see scripts/docker-clean.mjs) are safe to
// cache forever.
const HASHED_ASSET_ROUTE = /^\/(?:js|assets)\//;
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const MIME_BY_EXT: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

/**
 * Serve the pre-built brotli/gzip sibling of a hashed bundle directly, so the
 * box never re-compresses multi-MB bundles per request and browsers cache them
 * immutably. Returns true when it fully handled the response.
 */
function servePrecompressed(root: string, req: Request, res: Response): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  // Ranged requests need serveStatic's byte-range handling; let them through.
  if (req.headers.range || !HASHED_ASSET_ROUTE.test(req.path)) {
    return false;
  }
  const mime = MIME_BY_EXT[extname(req.path)];
  if (!mime) {
    return false;
  }

  let rel: string;
  try {
    rel = normalize(decodeURIComponent(req.path));
  } catch {
    return false;
  }
  if (rel.includes('..')) {
    return false;
  }

  const accept = String(req.headers['accept-encoding'] ?? '');
  const variants: Array<[suffix: string, encoding: string]> = [];
  if (/\bbr\b/.test(accept)) variants.push(['.br', 'br']);
  if (/\bgzip\b/.test(accept)) variants.push(['.gz', 'gzip']);

  for (const [suffix, encoding] of variants) {
    const file = join(root, rel) + suffix;
    if (existsSync(file)) {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', IMMUTABLE_CACHE);
      res.setHeader('Content-Length', statSync(file).size);
      if (req.method === 'HEAD') {
        res.end();
      } else {
        createReadStream(file).pipe(res);
      }
      return true;
    }
  }
  return false;
}

@Injectable()
export class StaticFilesResolver implements OnModuleInit {
  constructor(
    private readonly config: Config,
    private readonly adapterHost: HttpAdapterHost,
    private readonly check: SetupMiddleware
  ) {}

  onModuleInit() {
    // in command line mode
    if (!this.adapterHost.httpAdapter) {
      return;
    }

    const app = this.adapterHost.httpAdapter.getInstance<Application>();
    // for example, '/notesgraph' in host [//host.com/notesgraph]
    const basePath = this.config.server.path;
    const staticPath = join(env.projectRoot, 'static');

    // web => {
    //   notesgraph: 'static/index.html',
    //   selfhost: 'static/selfhost.html'
    // }
    // admin => {
    //   notesgraph: 'static/admin/index.html',
    //   selfhost: 'static/admin/selfhost.html'
    // }
    // mobile => {
    //   notesgraph: 'static/mobile/index.html',
    //   selfhost: 'static/mobile/selfhost.html'
    // }
    // NOTE(@forehalo):
    //   the order following routes should be respected,
    //   otherwise the app won't work properly.

    // START REGION: /admin
    // do not allow '/index.html' url, redirect to '/'
    app.get(basePath + '/admin/index.html', (_req, res) => {
      return res.redirect(basePath + '/admin');
    });

    // serve all static files
    app.use(
      basePath + '/admin',
      serveStatic(join(staticPath, 'admin'), {
        redirect: false,
        index: false,
        fallthrough: true,
      })
    );

    // fallback all unknown routes
    app.get(
      [basePath + '/admin', basePath + '/admin/*path'],
      this.check.use,
      (_req, res) => {
        res.sendFile(
          join(
            staticPath,
            'admin',
            env.selfhosted ? 'selfhost.html' : 'index.html'
          )
        );
      }
    );
    // END REGION

    // START REGION: /mobile
    // serve all static files
    app.use(
      basePath,
      serveStatic(join(staticPath, 'mobile'), {
        redirect: false,
        index: false,
        fallthrough: true,
      })
    );
    // END REGION

    // START REGION: /
    // do not allow '/index.html' url, redirect to '/'
    app.get(basePath + '/index.html', (_req, res) => {
      return res.redirect(basePath);
    });

    // Prefer the pre-built brotli/gzip of hashed bundles (no per-request
    // compression on the box); falls through to raw serving when absent.
    app.use(basePath, (req, res, next) => {
      if (servePrecompressed(staticPath, req, res)) {
        return;
      }
      next();
    });

    // serve all static files
    app.use(
      basePath,
      serveStatic(staticPath, {
        redirect: false,
        index: false,
        fallthrough: true,
        immutable: true,
        dotfiles: 'ignore',
        setHeaders: (res, filePath) => {
          // Content-hashed build assets (their URL changes whenever their
          // bytes do) can be cached for a year, so a page refresh reuses the
          // local copy instead of re-downloading megabytes of bundle from the
          // origin every time. `max-age=0, immutable` (the express default
          // here) is honoured inconsistently — Safari ignores `immutable`, and
          // a hard reload refetches — so pin an explicit long max-age.
          if (/[/\\](?:js|assets)[/\\]/.test(filePath)) {
            res.setHeader(
              'Cache-Control',
              'public, max-age=31536000, immutable'
            );
          }
        },
      })
    );

    // fallback all unknown routes
    app.get([basePath, basePath + '/*path'], this.check.use, (req, res) => {
      const mobile =
        env.namespaces.canary &&
        isMobile({
          ua: req.headers['user-agent'] ?? undefined,
        });

      return res.sendFile(
        join(
          staticPath,
          mobile ? 'mobile' : '',
          env.selfhosted ? 'selfhost.html' : 'index.html'
        )
      );
    });
    // END REGION
  }
}
