// Minimal NotesGraph plugin client entry. It's plain ESM with a default export, so
// no build step is required for the dev demo. (A real plugin would
// `import { definePlugin } from '@notesgraph/plugin-sdk/client'` for types, and use
// JSX/React — externalized to the host — for richer panels.)
export default {
  activate(ctx) {
    // 1) A command in the command palette.
    ctx.ui.addCommand({
      id: 'hello',
      label: 'Plugin: Say hello',
      run: async () => {
        const count = ((await ctx.storage.get('count')) ?? 0) + 1;
        await ctx.storage.set('count', count);
        ctx.ui.notify({
          title: 'Hello from the dev plugin 👋',
          message: `Run count: ${count} (persisted across reloads)`,
          theme: 'success',
        });
      },
    });

    // 2) A right-sidebar panel. A component returning a string is a valid React
    // node, so no React import/build is needed for this demo.
    ctx.ui.addSidebarPanel({
      id: 'hello-panel',
      title: 'Hello Panel',
      component: function HelloPanel() {
        return 'Hello from a plugin sidebar panel 👋';
      },
    });

    // 3) Read + write the current doc via the docs capability.
    ctx.ui.addCommand({
      id: 'insert-paragraph',
      label: 'Plugin: Insert a paragraph',
      run: async () => {
        const doc = await ctx.docs.getCurrent();
        if (!doc) {
          ctx.ui.notify({ title: 'Open a doc first', theme: 'warning' });
          return;
        }
        const blocks = await ctx.docs.getBlocks(doc.id);
        const note = blocks.find(b => b.flavour === 'notesgraph:note');
        await ctx.docs.insertBlock(doc.id, {
          flavour: 'notesgraph:paragraph',
          props: { text: 'Inserted by a plugin 🎉' },
          parent: note?.id,
        });
        ctx.ui.notify({ title: 'Inserted a paragraph', theme: 'success' });
      },
    });

    // 4) Call the plugin's own backend function (server.js) via the FaaS sidecar.
    ctx.ui.addCommand({
      id: 'greet-backend',
      label: 'Plugin: Call backend (greet)',
      run: async () => {
        try {
          const res = await ctx.backend.invoke('greet', { name: 'NotesGraph' });
          ctx.ui.notify({
            title: res.message,
            message: `Server-side count: ${res.serverCount}`,
            theme: 'success',
          });
        } catch (err) {
          ctx.ui.notify({
            title: 'Backend call failed',
            message: String(err),
            theme: 'error',
          });
        }
      },
    });
  },
};
