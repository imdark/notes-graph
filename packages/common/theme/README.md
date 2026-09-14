# @toeverything/theme (vendored)

Local, in-tree copy of `@toeverything/theme`, vendored from the upstream
[`toeverything/design`](https://github.com/toeverything/design) repo
(`packages/theme`) at tag **1.1.23** — the version this project previously
consumed from npm.

It is wired into the workspace under the original package name
`@toeverything/theme`, so every consumer's `import ... from '@toeverything/theme'`
is unchanged; dependents reference it with `workspace:*`.

## Editing & building

The `src/` here is the editable source. Consumers resolve the package through its
built `dist/` (mirroring how the published npm package is consumed: ESM + CJS +
`.d.ts`, plus the generated `dist/style.css`). After changing anything in `src/`,
rebuild:

```
yarn workspace @toeverything/theme build   # vite build (JS/CSS) + tsc (d.ts)
```

Notes:

- `build` runs two steps: `vite build` (with vanilla-extract) emits the JS/CJS
  bundles and the generated `dist/style.css`, then `tsc --emitDeclarationOnly`
  (via `tsconfig.build.json`) emits `dist/**/*.d.ts`. We use `tsc` for the
  declarations instead of `vite-plugin-dts` because that plugin's
  api-extractor coupling breaks in this monorepo.
- The build tsconfig is intentionally named `tsconfig.build.json` (not
  `tsconfig.json`) so `notesgraph init` does not add this package to the root
  `tsc -b` project graph — consumers resolve its types from `dist/*.d.ts`, exactly
  as they did when it was an external dependency.
- Build tooling (`vite`, `@vanilla-extract/vite-plugin`) is pinned to the
  upstream versions so the original `vite.config.ts` reproduces the same `dist/`
  artifacts (`style.css`, `*.cjs`).
- Updating the theme = re-vendor `src/` + `fonts/` from a newer
  `toeverything/design` tag and rebuild.
