import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { CapacitorConfig } from '@capacitor/cli';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8')
);

const capServerUrl = process.env.CAP_SERVER_URL;
const allowsCleartextServer = capServerUrl?.startsWith('http://') ?? false;

interface AppConfig {
  notesgraphVersion: string;
}

const config: CapacitorConfig & AppConfig = {
  appId: 'app.notesgraph.pro',
  appName: 'NotesGraph',
  webDir: 'dist',
  notesgraphVersion: packageJson.version,
  // The default ('debug') logs every plugin call and result to the console in
  // debug builds — tens of thousands a minute from the search index. With the
  // on-screen debug console on, those rows piled up until the WebView renderer
  // was killed for memory (~2 GB), reloading the app to Home.
  loggingBehavior: 'none',
  android: {
    path: 'App',
    buildOptions: {
      keystorePath: join(__dirname, 'notesgraph.keystore'),
      keystorePassword: process.env.NOTESGRAPH_ANDROID_KEYSTORE_PASSWORD,
      keystoreAlias: 'key0',
      keystoreAliasPassword:
        process.env.NOTESGRAPH_ANDROID_KEYSTORE_ALIAS_PASSWORD,
      releaseType: 'AAB',
    },
    adjustMarginsForEdgeToEdge: 'force',
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    CapacitorCookies: {
      enabled: false,
    },
  },
};

if (capServerUrl) {
  Object.assign(config, {
    server: {
      url: capServerUrl,
      cleartext: allowsCleartextServer,
    },
  });
}

export default config;
