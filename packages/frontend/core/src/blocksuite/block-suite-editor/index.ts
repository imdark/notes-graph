import { editorEffects } from '@notesgraph/core/blocksuite/editors';

import { registerTemplates } from './register-templates';

editorEffects();
// AI editor effects (custom elements for chat blocks, panels, widgets) are
// registered lazily by ensureAIViewExtension (manager/view.ts) — a static
// import here would drag the ~9MB blocksuite/ai bundle into the initial load.
registerTemplates();

export * from './blocksuite-editor';
