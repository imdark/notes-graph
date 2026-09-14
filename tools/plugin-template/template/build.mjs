import * as esbuild from 'esbuild';

// Bundle the client (React JSX) and server entries to ESM. React is bundled in
// for a zero-config demo; for shared React (hooks across host↔plugin) add
// `external: ['react', 'react/jsx-runtime']` and a host import map.
const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  logLevel: 'info',
};

await esbuild.build({
  ...common,
  entryPoints: ['src/client.tsx'],
  outfile: 'dist/index.js',
  jsx: 'automatic',
});

await esbuild.build({
  ...common,
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  platform: 'node',
});

console.log('built dist/index.js + dist/server.js');
