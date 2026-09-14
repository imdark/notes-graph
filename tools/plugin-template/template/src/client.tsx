import {
  definePlugin,
  type PluginContext,
} from '@notesgraph/plugin-sdk/client';

// A simple, hook-free panel. (Panels that use React hooks need the host to
// share its React instance via an import map — see README.)
function Panel({ ctx }: { ctx: PluginContext }) {
  return (
    <div
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <strong>__PLUGIN_NAME__</strong>
      <button
        onClick={() => {
          ctx.backend
            .invoke('ping')
            .then(result =>
              ctx.ui.notify({
                title: 'ping',
                message: JSON.stringify(result),
                theme: 'success',
              })
            )
            .catch((err: unknown) =>
              ctx.ui.notify({ title: 'ping failed', message: String(err) })
            );
        }}
      >
        Call backend
      </button>
    </div>
  );
}

export default definePlugin({
  activate(ctx) {
    ctx.ui.addCommand({
      id: 'hello',
      label: '__PLUGIN_NAME__: Hello',
      run: () =>
        ctx.ui.notify({
          title: 'Hello from __PLUGIN_NAME__',
          theme: 'success',
        }),
    });
    ctx.ui.addSidebarPanel({
      id: 'panel',
      title: '__PLUGIN_NAME__',
      component: () => <Panel ctx={ctx} />,
    });
  },
});
