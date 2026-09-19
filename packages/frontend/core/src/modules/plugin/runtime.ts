import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import * as jsxRuntime from 'react/jsx-runtime';
import * as react from 'react';

/**
 * Publish the host's React to plugins.
 *
 * A plugin is loaded with `import()` from a URL and bundles its own
 * dependencies, so without this it gets a second React: its hooks read a
 * different dispatcher than the host's renderer and throw as soon as a
 * component mounts. The page's import map (see the `<script type="importmap">`
 * in the HTML template) resolves the bare specifiers `react`,
 * `react/jsx-runtime` and `react/jsx-dev-runtime` to the shims under
 * `/plugin-runtime/`, which read the instance from this global.
 *
 * The plugin's own build must mark those specifiers external, or it will
 * inline its own copy again and the import map never comes into play.
 *
 * Ordering matters: this runs as a module side effect at import time, and
 * `modules/plugin/index.ts` imports it, so it is in place well before
 * PluginService's constructor restores previously-installed plugins.
 */
declare global {
  // eslint-disable-next-line no-var
  var __NOTESGRAPH_PLUGIN_RUNTIME__:
    | {
        react: typeof react;
        jsxRuntime: typeof jsxRuntime;
        jsxDevRuntime: typeof jsxDevRuntime;
      }
    | undefined;
}

globalThis.__NOTESGRAPH_PLUGIN_RUNTIME__ = {
  react,
  jsxRuntime,
  jsxDevRuntime,
};
