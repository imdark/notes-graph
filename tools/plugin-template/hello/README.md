# Hello — NotesGraph dev plugin demo

A minimal plugin proving the client path: dev-load → activate → contribute a
command → run it from the command palette. Uses `ctx.ui` and `ctx.storage`.

## Try it

1. Serve this folder with CORS enabled (dynamic `import()` of the bundle and the
   manifest fetch are cross-origin):

   ```sh
   cd tools/plugin-template/hello
   npx http-server -p 5999 --cors
   ```

2. In NotesGraph, open **Settings → Plugins** (or run **"Plugins: Manage plugins…"**
   from the command palette), paste `http://localhost:5999` into "Load a dev
   plugin", and click **Load**.

3. The plugin activates and contributes:
   - **Command** — open the palette and run **"Plugin: Say hello"** for a toast
     with a counter that persists across reloads (the dev plugin list is
     restored on startup, so the contribution stays registered).
   - **Sidebar panel** — open a doc, open the right sidebar, and pick the plugin
     tab (puzzle icon) to see the "Hello Panel".
   - **Docs read/write** — open a doc, then run **"Plugin: Insert a paragraph"**
     to append a paragraph block to it (uses `docs.getCurrent`/`getBlocks`/
     `insertBlock`).
   - **Backend (FaaS)** — run **"Plugin: Call backend (greet)"** to call the
     plugin's own `server.js` via the marketplace sidecar (`ctx.backend.invoke`);
     the server keeps a persisted count.

## Files

- `manifest.json` — id, version, declared `permissions` (`ui`, `storage`), and
  `entry.client`.
- `index.js` — `export default { activate(ctx) { … } }`.
