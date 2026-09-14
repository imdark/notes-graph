import { parseManifest, type PluginManifest } from '@notesgraph/plugin-sdk';

export const EDGELESS_PLUGIN_ID = 'com.notesgraph.edgeless';

/**
 * Manifest for the first-party edgeless (whiteboard) plugin. It requests the
 * `docModes` capability so it can contribute the edgeless doc mode (editor +
 * view extensions + UI metadata), and ships disabled by default (see
 * {@link PluginService.registerBuiltin}).
 */
export const edgelessManifest: PluginManifest = parseManifest({
  id: EDGELESS_PLUGIN_ID,
  name: 'Edgeless',
  version: '1.0.0',
  description: 'Edgeless (whiteboard / canvas) editor mode.',
  permissions: ['docModes'],
});
