import { parseManifest, type PluginManifest } from '@notesgraph/plugin-sdk';

export const CODE_RUNNER_PLUGIN_ID = 'com.notesgraph.code-runner';

/**
 * Manifest for the first-party code runner, modelled on org-mode Babel: a
 * JavaScript code block gets a Run button (and Mod-Enter, the way C-c C-c
 * runs an org source block), and its output lands in a "Results" block
 * right below it. It needs the `editor` capability to add the toolbar
 * button and keymap, and ships disabled by default.
 */
export const codeRunnerManifest: PluginManifest = parseManifest({
  id: CODE_RUNNER_PLUGIN_ID,
  name: 'Run code blocks',
  version: '1.0.0',
  description:
    'Run JavaScript code blocks in place and keep the output in a Results block below them, like org-mode Babel.',
  permissions: ['editor'],
});
