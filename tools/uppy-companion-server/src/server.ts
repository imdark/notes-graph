import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { socket } from '@uppy/companion';
import buildStandaloneApp from '@uppy/companion/standalone';

// Companion's own standalone builder reads all provider/session config from
// COMPANION_* env vars (COMPANION_GOOGLE_KEY/_SECRET, COMPANION_DROPBOX_KEY/_SECRET,
// COMPANION_DOMAIN, COMPANION_PROTOCOL, COMPANION_SECRET, COMPANION_DATADIR, ...).
// See https://uppy.io/docs/companion/#Configure-Standalone for the full list.
const PORT = Number(process.env.COMPANION_PORT ?? process.env.PORT ?? 3020);

// Companion hard-requires both of these to be set (and COMPANION_DATADIR to
// already exist) — default them so a bare `yarn start` works out of the box.
process.env.COMPANION_DOMAIN ??= `localhost:${PORT}`;
process.env.COMPANION_PROTOCOL ??= 'http';
process.env.COMPANION_DATADIR ??= join(tmpdir(), 'notesgraph-uppy-companion');
mkdirSync(process.env.COMPANION_DATADIR, { recursive: true });

if (
  !process.env.COMPANION_CLIENT_ORIGINS &&
  !process.env.COMPANION_CLIENT_ORIGINS_REGEX
) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'uppy-companion-server: COMPANION_CLIENT_ORIGINS must be set in ' +
        'production — a comma-separated list of allowed frontend origins ' +
        '(e.g. "https://notes.example.com").'
    );
    process.exit(1);
  }
  // Permissive default for local dev only; production must opt in explicitly.
  process.env.COMPANION_CLIENT_ORIGINS = 'true';
}

const PROVIDERS = [
  ['Google Drive', 'COMPANION_GOOGLE_KEY'],
  ['Dropbox', 'COMPANION_DROPBOX_KEY'],
] as const;

const enabledProviders = PROVIDERS.filter(([, envKey]) => !!process.env[envKey]);

if (enabledProviders.length === 0) {
  console.warn(
    'uppy-companion-server: no provider credentials configured ' +
      '(COMPANION_GOOGLE_KEY / COMPANION_DROPBOX_KEY) — starting anyway, ' +
      'but no remote sources will be available.'
  );
} else {
  console.log(
    `uppy-companion-server: enabled providers: ${enabledProviders.map(([name]) => name).join(', ')}`
  );
}

const { app } = buildStandaloneApp({}) as {
  app: {
    listen: (port: number, callback: () => void) => Server;
  };
};
const server = app.listen(PORT, () => {
  console.log(`uppy-companion-server listening on http://localhost:${PORT}`);
});
socket(server);
