import { definePlugin } from '@notesgraph/plugin-sdk/client';

/**
 * The edgeless plugin definition. On activation it dynamically imports the
 * edgeless mode bundle and registers the edgeless doc mode; the host then
 * renders the page/edgeless toggle, "New Edgeless" entries, the primary-mode
 * property, the new-doc-default option, and the edgeless editor itself from that
 * descriptor — so no core surface hardcodes edgeless. Everything edgeless (the
 * editor shell, toggle visual, icons, and gfx view extensions) lives in the
 * dynamically-imported chunk, so it only loads once the plugin is enabled.
 *
 * Deactivation tears the contribution down through the context subscriptions,
 * which removes the mode from the registry and every surface updates for free.
 */
export const edgelessPluginDefinition = definePlugin({
  async activate(ctx) {
    const { createEdgelessDocMode } = await import('./views/edgeless-mode');
    ctx.docModes.register(createEdgelessDocMode());
  },
});
