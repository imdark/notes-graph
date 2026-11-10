import { definePlugin } from '@notesgraph/plugin-sdk/client';

/**
 * Loads the editor half of the code runner only once the plugin is enabled,
 * and hands its view-extension provider to the host. Disabling the plugin
 * disposes the registration, which drops the Run button and keymap.
 */
export const codeRunnerPluginDefinition = definePlugin({
  async activate(ctx) {
    const { CodeRunnerViewExtension } = await import(
      './views/code-runner-view-extension'
    );
    ctx.editor.registerViewExtensions([CodeRunnerViewExtension]);
  },
});
