# **PLUGIN_NAME**

An NotesGraph plugin. Scaffolded with `notesgraph plugin create`.

## Develop

```sh
yarn            # install deps (@notesgraph/plugin-sdk, esbuild, react)
notesgraph plugin dev   # build + serve on http://localhost:5999 (CORS)
```

Then in NotesGraph: **Settings → Plugins → Development → Load a dev plugin** →
`http://localhost:5999`.

## Publish

```sh
notesgraph plugin publish --registry http://localhost:8099
```

This builds and POSTs `manifest.json` + `dist/*` to the marketplace sidecar
(`@notesgraph/plugin-server`), which auto-signs and lists it.

## Structure

- `manifest.json` — id, version, declared `permissions`, `entry.client/server`.
- `src/client.tsx` — `definePlugin({ activate(ctx) })`: commands, panels, docs,
  hooks, storage, backend, native.
- `src/server.ts` — `defineServer({ functions })`: backend functions run in the
  FaaS runtime, callable via `ctx.backend.invoke(name, payload)`.
- `build.mjs` — esbuild → `dist/index.js` + `dist/server.js`.

## Notes

- The demo panel is hook-free. Panels using React hooks need the host to share
  its React instance (import map) so host and plugin use one React — a host
  follow-up; until then keep panels hook-free or render via the host.
- For a zero-build example see `tools/plugin-template/hello` (plain ESM, no SDK
  import, no bundler).
