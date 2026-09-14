// Auto generated content
// DO NOT MODIFY THIS FILE MANUALLY
export const PackageList = [
  {
    location: 'blocksuite/docs',
    name: '@blocksuite/bs-docs',
    workspaceDependencies: [],
  },
  {
    location: 'blocksuite/docs-site',
    name: '@blocksuite/docs',
    workspaceDependencies: ['blocksuite/notesgraph/all'],
  },
  {
    location: 'blocksuite/framework/global',
    name: '@blocksuite/global',
    workspaceDependencies: [],
  },
  {
    location: 'blocksuite/framework/std',
    name: '@blocksuite/std',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/framework/store',
    name: '@blocksuite/store',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/framework/sync',
    ],
  },
  {
    location: 'blocksuite/framework/sync',
    name: '@blocksuite/sync',
    workspaceDependencies: ['blocksuite/framework/global'],
  },
  {
    location: 'blocksuite/integration-test',
    name: '@blocksuite/integration-test',
    workspaceDependencies: [
      'blocksuite/notesgraph/all',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/all',
    name: '@blocksuite/notesgraph',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/attachment',
      'blocksuite/notesgraph/blocks/bookmark',
      'blocksuite/notesgraph/blocks/callout',
      'blocksuite/notesgraph/blocks/code',
      'blocksuite/notesgraph/blocks/data-view',
      'blocksuite/notesgraph/blocks/database',
      'blocksuite/notesgraph/blocks/divider',
      'blocksuite/notesgraph/blocks/edgeless-text',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/embed-doc',
      'blocksuite/notesgraph/blocks/frame',
      'blocksuite/notesgraph/blocks/image',
      'blocksuite/notesgraph/blocks/latex',
      'blocksuite/notesgraph/blocks/list',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/blocks/paragraph',
      'blocksuite/notesgraph/blocks/root',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/blocks/surface-ref',
      'blocksuite/notesgraph/blocks/table',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/foundation',
      'blocksuite/notesgraph/fragments/adapter-panel',
      'blocksuite/notesgraph/fragments/doc-title',
      'blocksuite/notesgraph/fragments/frame-panel',
      'blocksuite/notesgraph/fragments/outline',
      'blocksuite/notesgraph/gfx/brush',
      'blocksuite/notesgraph/gfx/connector',
      'blocksuite/notesgraph/gfx/group',
      'blocksuite/notesgraph/gfx/link',
      'blocksuite/notesgraph/gfx/mindmap',
      'blocksuite/notesgraph/gfx/note',
      'blocksuite/notesgraph/gfx/pointer',
      'blocksuite/notesgraph/gfx/shape',
      'blocksuite/notesgraph/gfx/template',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/gfx/turbo-renderer',
      'blocksuite/notesgraph/inlines/comment',
      'blocksuite/notesgraph/inlines/footnote',
      'blocksuite/notesgraph/inlines/latex',
      'blocksuite/notesgraph/inlines/link',
      'blocksuite/notesgraph/inlines/mention',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/drag-handle',
      'blocksuite/notesgraph/widgets/edgeless-auto-connect',
      'blocksuite/notesgraph/widgets/edgeless-dragging-area',
      'blocksuite/notesgraph/widgets/edgeless-selected-rect',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/notesgraph/widgets/edgeless-zoom-toolbar',
      'blocksuite/notesgraph/widgets/frame-title',
      'blocksuite/notesgraph/widgets/keyboard-toolbar',
      'blocksuite/notesgraph/widgets/linked-doc',
      'blocksuite/notesgraph/widgets/note-slicer',
      'blocksuite/notesgraph/widgets/page-dragging-area',
      'blocksuite/notesgraph/widgets/remote-selection',
      'blocksuite/notesgraph/widgets/scroll-anchoring',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/notesgraph/widgets/toolbar',
      'blocksuite/notesgraph/widgets/viewport-overlay',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'blocksuite/framework/sync',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/attachment',
    name: '@blocksuite/notesgraph-block-attachment',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/bookmark',
    name: '@blocksuite/notesgraph-block-bookmark',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/embed-doc',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/callout',
    name: '@blocksuite/notesgraph-block-callout',
    workspaceDependencies: [
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/code',
    name: '@blocksuite/notesgraph-block-code',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/turbo-renderer',
      'blocksuite/notesgraph/inlines/comment',
      'blocksuite/notesgraph/inlines/latex',
      'blocksuite/notesgraph/inlines/link',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/data-view',
    name: '@blocksuite/notesgraph-block-data-view',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/database',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/database',
    name: '@blocksuite/notesgraph-block-database',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/drag-handle',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/divider',
    name: '@blocksuite/notesgraph-block-divider',
    workspaceDependencies: [
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/edgeless-text',
    name: '@blocksuite/notesgraph-block-edgeless-text',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/embed',
    name: '@blocksuite/notesgraph-block-embed',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/embed-doc',
    name: '@blocksuite/notesgraph-block-embed-doc',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/frame',
    name: '@blocksuite/notesgraph-block-frame',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/pointer',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/notesgraph/widgets/frame-title',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/image',
    name: '@blocksuite/notesgraph-block-image',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/turbo-renderer',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/latex',
    name: '@blocksuite/notesgraph-block-latex',
    workspaceDependencies: [
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/latex',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/list',
    name: '@blocksuite/notesgraph-block-list',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/turbo-renderer',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/note',
    name: '@blocksuite/notesgraph-block-note',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/fragments/doc-title',
      'blocksuite/notesgraph/gfx/turbo-renderer',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/paragraph',
    name: '@blocksuite/notesgraph-block-paragraph',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/turbo-renderer',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/root',
    name: '@blocksuite/notesgraph-block-root',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/attachment',
      'blocksuite/notesgraph/blocks/bookmark',
      'blocksuite/notesgraph/blocks/database',
      'blocksuite/notesgraph/blocks/edgeless-text',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/frame',
      'blocksuite/notesgraph/blocks/image',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/blocks/paragraph',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/brush',
      'blocksuite/notesgraph/gfx/connector',
      'blocksuite/notesgraph/gfx/group',
      'blocksuite/notesgraph/gfx/mindmap',
      'blocksuite/notesgraph/gfx/note',
      'blocksuite/notesgraph/gfx/pointer',
      'blocksuite/notesgraph/gfx/shape',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/inlines/latex',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/surface',
    name: '@blocksuite/notesgraph-block-surface',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/surface-ref',
    name: '@blocksuite/notesgraph-block-surface-ref',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/frame',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/blocks/table',
    name: '@blocksuite/notesgraph-block-table',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/slash-menu',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/components',
    name: '@blocksuite/notesgraph-components',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'blocksuite/framework/sync',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/data-view',
    name: '@blocksuite/data-view',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/ext-loader',
    name: '@blocksuite/notesgraph-ext-loader',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/foundation',
    name: '@blocksuite/notesgraph-foundation',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/fragments/adapter-panel',
    name: '@blocksuite/notesgraph-fragment-adapter-panel',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/fragments/doc-title',
    name: '@blocksuite/notesgraph-fragment-doc-title',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/fragments/frame-panel',
    name: '@blocksuite/notesgraph-fragment-frame-panel',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/frame',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/fragments/outline',
    name: '@blocksuite/notesgraph-fragment-outline',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/fragments/doc-title',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/brush',
    name: '@blocksuite/notesgraph-gfx-brush',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/connector',
    name: '@blocksuite/notesgraph-gfx-connector',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/group',
    name: '@blocksuite/notesgraph-gfx-group',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/link',
    name: '@blocksuite/notesgraph-gfx-link',
    workspaceDependencies: [
      'blocksuite/notesgraph/blocks/bookmark',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/mindmap',
    name: '@blocksuite/notesgraph-gfx-mindmap',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/attachment',
      'blocksuite/notesgraph/blocks/image',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/connector',
      'blocksuite/notesgraph/gfx/pointer',
      'blocksuite/notesgraph/gfx/shape',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/note',
    name: '@blocksuite/notesgraph-gfx-note',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/attachment',
      'blocksuite/notesgraph/blocks/bookmark',
      'blocksuite/notesgraph/blocks/image',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/pointer',
    name: '@blocksuite/notesgraph-gfx-pointer',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/shape',
    name: '@blocksuite/notesgraph-gfx-shape',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/template',
    name: '@blocksuite/notesgraph-gfx-template',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/text',
    name: '@blocksuite/notesgraph-gfx-text',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-toolbar',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/gfx/turbo-renderer',
    name: '@blocksuite/notesgraph-gfx-turbo-renderer',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/comment',
    name: '@blocksuite/notesgraph-inline-comment',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/footnote',
    name: '@blocksuite/notesgraph-inline-footnote',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/latex',
    name: '@blocksuite/notesgraph-inline-latex',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/link',
    name: '@blocksuite/notesgraph-inline-link',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/mention',
    name: '@blocksuite/notesgraph-inline-mention',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/preset',
    name: '@blocksuite/notesgraph-inline-preset',
    workspaceDependencies: [
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/comment',
      'blocksuite/notesgraph/inlines/footnote',
      'blocksuite/notesgraph/inlines/latex',
      'blocksuite/notesgraph/inlines/link',
      'blocksuite/notesgraph/inlines/mention',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/inlines/reference',
    name: '@blocksuite/notesgraph-inline-reference',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/model',
    name: '@blocksuite/notesgraph-model',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/rich-text',
    name: '@blocksuite/notesgraph-rich-text',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/shared',
    name: '@blocksuite/notesgraph-shared',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/model',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/drag-handle',
    name: '@blocksuite/notesgraph-widget-drag-handle',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/callout',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/list',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/blocks/paragraph',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/edgeless-auto-connect',
    name: '@blocksuite/notesgraph-widget-edgeless-auto-connect',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/edgeless-dragging-area',
    name: '@blocksuite/notesgraph-widget-edgeless-dragging-area',
    workspaceDependencies: [
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/edgeless-selected-rect',
    name: '@blocksuite/notesgraph-widget-edgeless-selected-rect',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/frame',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/gfx/connector',
      'blocksuite/notesgraph/gfx/shape',
      'blocksuite/notesgraph/gfx/text',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/edgeless-toolbar',
    name: '@blocksuite/notesgraph-widget-edgeless-toolbar',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/edgeless-zoom-toolbar',
    name: '@blocksuite/notesgraph-widget-edgeless-zoom-toolbar',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/frame-title',
    name: '@blocksuite/notesgraph-widget-frame-title',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/keyboard-toolbar',
    name: '@blocksuite/notesgraph-widget-keyboard-toolbar',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/attachment',
      'blocksuite/notesgraph/blocks/database',
      'blocksuite/notesgraph/blocks/embed',
      'blocksuite/notesgraph/blocks/image',
      'blocksuite/notesgraph/blocks/latex',
      'blocksuite/notesgraph/blocks/list',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/blocks/paragraph',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/blocks/surface-ref',
      'blocksuite/notesgraph/blocks/table',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/fragments/doc-title',
      'blocksuite/notesgraph/inlines/latex',
      'blocksuite/notesgraph/inlines/link',
      'blocksuite/notesgraph/inlines/preset',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/linked-doc',
    name: '@blocksuite/notesgraph-widget-linked-doc',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/inlines/reference',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/note-slicer',
    name: '@blocksuite/notesgraph-widget-note-slicer',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/note',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/notesgraph/widgets/edgeless-selected-rect',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/page-dragging-area',
    name: '@blocksuite/notesgraph-widget-page-dragging-area',
    workspaceDependencies: [
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/remote-selection',
    name: '@blocksuite/notesgraph-widget-remote-selection',
    workspaceDependencies: [
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/scroll-anchoring',
    name: '@blocksuite/notesgraph-widget-scroll-anchoring',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/slash-menu',
    name: '@blocksuite/notesgraph-widget-slash-menu',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/rich-text',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'blocksuite/framework/store',
      'packages/common/theme',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/toolbar',
    name: '@blocksuite/notesgraph-widget-toolbar',
    workspaceDependencies: [
      'blocksuite/framework/global',
      'blocksuite/notesgraph/blocks/database',
      'blocksuite/notesgraph/blocks/surface',
      'blocksuite/notesgraph/blocks/table',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/notesgraph/widgets/viewport-overlay',
    name: '@blocksuite/notesgraph-widget-viewport-overlay',
    workspaceDependencies: [
      'blocksuite/notesgraph/ext-loader',
      'blocksuite/notesgraph/model',
      'blocksuite/framework/std',
    ],
  },
  {
    location: 'blocksuite/playground',
    name: '@blocksuite/playground',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/integration-test',
      'blocksuite/notesgraph/all',
      'blocksuite/notesgraph/model',
      'blocksuite/notesgraph/shared',
    ],
  },
  {
    location: 'docs/reference',
    name: '@notesgraph/docs',
    workspaceDependencies: [],
  },
  {
    location: 'packages/backend/native',
    name: '@notesgraph/server-native',
    workspaceDependencies: [],
  },
  {
    location: 'packages/backend/server',
    name: '@notesgraph/server',
    workspaceDependencies: [
      'packages/common/s3-compat',
      'packages/backend/native',
      'tools/cli',
      'tools/utils',
      'packages/common/graphql',
      'packages/common/realtime',
    ],
  },
  {
    location: 'packages/common/debug',
    name: '@notesgraph/debug',
    workspaceDependencies: [],
  },
  {
    location: 'packages/common/env',
    name: '@notesgraph/env',
    workspaceDependencies: [],
  },
  {
    location: 'packages/common/error',
    name: '@notesgraph/error',
    workspaceDependencies: [],
  },
  {
    location: 'packages/common/graphql',
    name: '@notesgraph/graphql',
    workspaceDependencies: ['packages/common/debug', 'packages/common/error'],
  },
  {
    location: 'packages/common/infra',
    name: '@notesgraph/infra',
    workspaceDependencies: [
      'packages/common/debug',
      'packages/common/env',
      'packages/common/error',
      'packages/frontend/templates',
    ],
  },
  {
    location: 'packages/common/link-card',
    name: '@notesgraph/link-card',
    workspaceDependencies: [],
  },
  {
    location: 'packages/common/nbstore',
    name: '@notesgraph/nbstore',
    workspaceDependencies: [
      'packages/common/infra',
      'packages/common/reader',
      'packages/common/realtime',
      'blocksuite/notesgraph/all',
      'packages/common/error',
      'packages/common/graphql',
    ],
  },
  {
    location: 'packages/common/plugin-sdk',
    name: '@notesgraph/plugin-sdk',
    workspaceDependencies: [],
  },
  {
    location: 'packages/common/reader',
    name: '@notesgraph/reader',
    workspaceDependencies: ['blocksuite/notesgraph/all'],
  },
  {
    location: 'packages/common/realtime',
    name: '@notesgraph/realtime',
    workspaceDependencies: ['packages/common/graphql'],
  },
  {
    location: 'packages/common/s3-compat',
    name: '@notesgraph/s3-compat',
    workspaceDependencies: [],
  },
  {
    location: 'packages/common/theme',
    name: '@toeverything/theme',
    workspaceDependencies: [],
  },
  {
    location: 'packages/frontend/admin',
    name: '@notesgraph/admin',
    workspaceDependencies: [
      'packages/frontend/component',
      'packages/frontend/core',
      'packages/common/error',
      'packages/common/graphql',
      'packages/frontend/routes',
      'packages/common/theme',
    ],
  },
  {
    location: 'packages/frontend/apps/android',
    name: '@notesgraph/android',
    workspaceDependencies: [
      'blocksuite/notesgraph/all',
      'packages/frontend/component',
      'packages/frontend/core',
      'packages/common/env',
      'packages/frontend/i18n',
      'packages/common/infra',
      'packages/frontend/apps/mobile-shared',
      'packages/common/nbstore',
      'packages/frontend/track',
    ],
  },
  {
    location: 'packages/frontend/apps/electron',
    name: '@notesgraph/electron',
    workspaceDependencies: [
      'tools/utils',
      'packages/frontend/i18n',
      'packages/common/infra',
      'packages/common/link-card',
      'packages/frontend/native',
      'packages/common/nbstore',
    ],
  },
  {
    location: 'packages/frontend/apps/electron-renderer',
    name: '@notesgraph/electron-renderer',
    workspaceDependencies: [
      'blocksuite/notesgraph/all',
      'packages/frontend/component',
      'packages/frontend/core',
      'packages/common/debug',
      'packages/frontend/electron-api',
      'packages/frontend/i18n',
      'packages/common/infra',
      'packages/common/nbstore',
      'packages/frontend/track',
      'packages/common/theme',
    ],
  },
  {
    location: 'packages/frontend/apps/ios',
    name: '@notesgraph/ios',
    workspaceDependencies: [
      'blocksuite/notesgraph/all',
      'packages/frontend/component',
      'packages/frontend/core',
      'packages/common/env',
      'packages/common/graphql',
      'packages/frontend/i18n',
      'packages/common/infra',
      'packages/frontend/apps/mobile-shared',
      'packages/common/nbstore',
      'packages/frontend/track',
      'tools/cli',
      'tools/utils',
    ],
  },
  {
    location: 'packages/frontend/apps/mobile',
    name: '@notesgraph/mobile',
    workspaceDependencies: [
      'blocksuite/notesgraph/all',
      'packages/frontend/component',
      'packages/frontend/core',
      'packages/common/env',
      'packages/common/infra',
      'packages/common/nbstore',
      'packages/frontend/track',
    ],
  },
  {
    location: 'packages/frontend/apps/mobile-shared',
    name: '@notesgraph/mobile-shared',
    workspaceDependencies: ['packages/frontend/core'],
  },
  {
    location: 'packages/frontend/apps/web',
    name: '@notesgraph/web',
    workspaceDependencies: [
      'packages/frontend/component',
      'packages/frontend/core',
      'packages/common/env',
      'packages/common/infra',
      'packages/common/nbstore',
      'packages/frontend/track',
    ],
  },
  {
    location: 'packages/frontend/component',
    name: '@notesgraph/component',
    workspaceDependencies: [
      'packages/common/debug',
      'packages/common/error',
      'packages/common/graphql',
      'packages/frontend/i18n',
      'packages/common/theme',
      'tools/utils',
    ],
  },
  {
    location: 'packages/frontend/core',
    name: '@notesgraph/core',
    workspaceDependencies: [
      'blocksuite/notesgraph/data-view',
      'blocksuite/framework/global',
      'blocksuite/notesgraph/all',
      'blocksuite/notesgraph/blocks/root',
      'blocksuite/notesgraph/components',
      'blocksuite/notesgraph/shared',
      'blocksuite/framework/std',
      'packages/frontend/component',
      'packages/common/debug',
      'packages/frontend/electron-api',
      'packages/common/env',
      'packages/common/error',
      'packages/common/graphql',
      'packages/frontend/i18n',
      'packages/common/infra',
      'packages/common/nbstore',
      'packages/common/plugin-sdk',
      'packages/common/reader',
      'packages/frontend/templates',
      'packages/frontend/track',
      'packages/common/theme',
      'blocksuite/notesgraph/ext-loader',
    ],
  },
  {
    location: 'packages/frontend/electron-api',
    name: '@notesgraph/electron-api',
    workspaceDependencies: ['packages/frontend/apps/electron'],
  },
  {
    location: 'packages/frontend/i18n',
    name: '@notesgraph/i18n',
    workspaceDependencies: [
      'packages/common/debug',
      'tools/cli',
      'tools/utils',
    ],
  },
  {
    location: 'packages/frontend/media-capture-playground',
    name: '@notesgraph/media-capture-playground',
    workspaceDependencies: ['packages/frontend/native'],
  },
  {
    location: 'packages/frontend/native',
    name: '@notesgraph/native',
    workspaceDependencies: [],
  },
  {
    location: 'packages/frontend/routes',
    name: '@notesgraph/routes',
    workspaceDependencies: ['tools/cli', 'tools/utils'],
  },
  {
    location: 'packages/frontend/templates',
    name: '@notesgraph/templates',
    workspaceDependencies: [],
  },
  {
    location: 'packages/frontend/track',
    name: '@notesgraph/track',
    workspaceDependencies: ['packages/common/debug'],
  },
  {
    location: 'tests/blocksuite',
    name: '@notesgraph-test/blocksuite',
    workspaceDependencies: [
      'blocksuite/integration-test',
      'blocksuite/notesgraph/all',
      'tests/kit',
      'packages/common/theme',
    ],
  },
  {
    location: 'tests/kit',
    name: '@notesgraph-test/kit',
    workspaceDependencies: [
      'blocksuite/notesgraph/all',
      'tools/utils',
      'packages/common/infra',
    ],
  },
  {
    location: 'tests/notesgraph-cloud',
    name: '@notesgraph-test/notesgraph-cloud',
    workspaceDependencies: ['tests/kit'],
  },
  {
    location: 'tests/notesgraph-cloud-copilot',
    name: '@notesgraph-test/notesgraph-cloud-copilot',
    workspaceDependencies: ['tests/kit'],
  },
  {
    location: 'tests/notesgraph-desktop',
    name: '@notesgraph-test/notesgraph-desktop',
    workspaceDependencies: ['tests/kit', 'packages/frontend/electron-api'],
  },
  {
    location: 'tests/notesgraph-desktop-cloud',
    name: '@notesgraph-test/notesgraph-desktop-cloud',
    workspaceDependencies: ['tests/kit'],
  },
  {
    location: 'tests/notesgraph-local',
    name: '@notesgraph-test/notesgraph-local',
    workspaceDependencies: ['tests/kit'],
  },
  {
    location: 'tests/notesgraph-mobile',
    name: '@notesgraph-test/notesgraph-mobile',
    workspaceDependencies: ['tests/kit'],
  },
  {
    location: 'tools/@types/build-config',
    name: '@types/build-config',
    workspaceDependencies: [],
  },
  {
    location: 'tools/@types/env',
    name: '@types/notesgraph__env',
    workspaceDependencies: ['blocksuite/notesgraph/all', 'packages/common/env'],
  },
  {
    location: 'tools/changelog',
    name: '@notesgraph/changelog',
    workspaceDependencies: [],
  },
  {
    location: 'tools/cli',
    name: '@notesgraph-tools/cli',
    workspaceDependencies: ['tools/utils', 'packages/common/s3-compat'],
  },
  {
    location: 'tools/commitlint',
    name: '@notesgraph/commitlint-config',
    workspaceDependencies: [],
  },
  {
    location: 'tools/copilot-result',
    name: '@notesgraph/copilot-result',
    workspaceDependencies: [],
  },
  {
    location: 'tools/doc-diff',
    name: '@notesgraph/doc-diff',
    workspaceDependencies: ['tools/cli'],
  },
  {
    location: 'tools/link-card-server',
    name: '@notesgraph/link-card-server',
    workspaceDependencies: ['packages/common/link-card', 'tools/cli'],
  },
  {
    location: 'tools/notesgraph-plugin-server',
    name: '@notesgraph/plugin-server',
    workspaceDependencies: ['packages/common/plugin-sdk', 'tools/cli'],
  },
  {
    location: 'tools/playstore-auto-bump',
    name: '@notesgraph/playstore-auto-bump',
    workspaceDependencies: ['tools/cli', 'tools/utils'],
  },
  {
    location: 'tools/revert-update',
    name: '@notesgraph/revert-update',
    workspaceDependencies: ['tools/cli'],
  },
  {
    location: 'tools/utils',
    name: '@notesgraph-tools/utils',
    workspaceDependencies: [],
  },
];

export type PackageName =
  | '@blocksuite/bs-docs'
  | '@blocksuite/docs'
  | '@blocksuite/global'
  | '@blocksuite/std'
  | '@blocksuite/store'
  | '@blocksuite/sync'
  | '@blocksuite/integration-test'
  | '@blocksuite/notesgraph'
  | '@blocksuite/notesgraph-block-attachment'
  | '@blocksuite/notesgraph-block-bookmark'
  | '@blocksuite/notesgraph-block-callout'
  | '@blocksuite/notesgraph-block-code'
  | '@blocksuite/notesgraph-block-data-view'
  | '@blocksuite/notesgraph-block-database'
  | '@blocksuite/notesgraph-block-divider'
  | '@blocksuite/notesgraph-block-edgeless-text'
  | '@blocksuite/notesgraph-block-embed'
  | '@blocksuite/notesgraph-block-embed-doc'
  | '@blocksuite/notesgraph-block-frame'
  | '@blocksuite/notesgraph-block-image'
  | '@blocksuite/notesgraph-block-latex'
  | '@blocksuite/notesgraph-block-list'
  | '@blocksuite/notesgraph-block-note'
  | '@blocksuite/notesgraph-block-paragraph'
  | '@blocksuite/notesgraph-block-root'
  | '@blocksuite/notesgraph-block-surface'
  | '@blocksuite/notesgraph-block-surface-ref'
  | '@blocksuite/notesgraph-block-table'
  | '@blocksuite/notesgraph-components'
  | '@blocksuite/data-view'
  | '@blocksuite/notesgraph-ext-loader'
  | '@blocksuite/notesgraph-foundation'
  | '@blocksuite/notesgraph-fragment-adapter-panel'
  | '@blocksuite/notesgraph-fragment-doc-title'
  | '@blocksuite/notesgraph-fragment-frame-panel'
  | '@blocksuite/notesgraph-fragment-outline'
  | '@blocksuite/notesgraph-gfx-brush'
  | '@blocksuite/notesgraph-gfx-connector'
  | '@blocksuite/notesgraph-gfx-group'
  | '@blocksuite/notesgraph-gfx-link'
  | '@blocksuite/notesgraph-gfx-mindmap'
  | '@blocksuite/notesgraph-gfx-note'
  | '@blocksuite/notesgraph-gfx-pointer'
  | '@blocksuite/notesgraph-gfx-shape'
  | '@blocksuite/notesgraph-gfx-template'
  | '@blocksuite/notesgraph-gfx-text'
  | '@blocksuite/notesgraph-gfx-turbo-renderer'
  | '@blocksuite/notesgraph-inline-comment'
  | '@blocksuite/notesgraph-inline-footnote'
  | '@blocksuite/notesgraph-inline-latex'
  | '@blocksuite/notesgraph-inline-link'
  | '@blocksuite/notesgraph-inline-mention'
  | '@blocksuite/notesgraph-inline-preset'
  | '@blocksuite/notesgraph-inline-reference'
  | '@blocksuite/notesgraph-model'
  | '@blocksuite/notesgraph-rich-text'
  | '@blocksuite/notesgraph-shared'
  | '@blocksuite/notesgraph-widget-drag-handle'
  | '@blocksuite/notesgraph-widget-edgeless-auto-connect'
  | '@blocksuite/notesgraph-widget-edgeless-dragging-area'
  | '@blocksuite/notesgraph-widget-edgeless-selected-rect'
  | '@blocksuite/notesgraph-widget-edgeless-toolbar'
  | '@blocksuite/notesgraph-widget-edgeless-zoom-toolbar'
  | '@blocksuite/notesgraph-widget-frame-title'
  | '@blocksuite/notesgraph-widget-keyboard-toolbar'
  | '@blocksuite/notesgraph-widget-linked-doc'
  | '@blocksuite/notesgraph-widget-note-slicer'
  | '@blocksuite/notesgraph-widget-page-dragging-area'
  | '@blocksuite/notesgraph-widget-remote-selection'
  | '@blocksuite/notesgraph-widget-scroll-anchoring'
  | '@blocksuite/notesgraph-widget-slash-menu'
  | '@blocksuite/notesgraph-widget-toolbar'
  | '@blocksuite/notesgraph-widget-viewport-overlay'
  | '@blocksuite/playground'
  | '@notesgraph/docs'
  | '@notesgraph/server-native'
  | '@notesgraph/server'
  | '@notesgraph/debug'
  | '@notesgraph/env'
  | '@notesgraph/error'
  | '@notesgraph/graphql'
  | '@notesgraph/infra'
  | '@notesgraph/link-card'
  | '@notesgraph/nbstore'
  | '@notesgraph/plugin-sdk'
  | '@notesgraph/reader'
  | '@notesgraph/realtime'
  | '@notesgraph/s3-compat'
  | '@toeverything/theme'
  | '@notesgraph/admin'
  | '@notesgraph/android'
  | '@notesgraph/electron'
  | '@notesgraph/electron-renderer'
  | '@notesgraph/ios'
  | '@notesgraph/mobile'
  | '@notesgraph/mobile-shared'
  | '@notesgraph/web'
  | '@notesgraph/component'
  | '@notesgraph/core'
  | '@notesgraph/electron-api'
  | '@notesgraph/i18n'
  | '@notesgraph/media-capture-playground'
  | '@notesgraph/native'
  | '@notesgraph/routes'
  | '@notesgraph/templates'
  | '@notesgraph/track'
  | '@notesgraph-test/blocksuite'
  | '@notesgraph-test/kit'
  | '@notesgraph-test/notesgraph-cloud'
  | '@notesgraph-test/notesgraph-cloud-copilot'
  | '@notesgraph-test/notesgraph-desktop'
  | '@notesgraph-test/notesgraph-desktop-cloud'
  | '@notesgraph-test/notesgraph-local'
  | '@notesgraph-test/notesgraph-mobile'
  | '@types/build-config'
  | '@types/notesgraph__env'
  | '@notesgraph/changelog'
  | '@notesgraph-tools/cli'
  | '@notesgraph/commitlint-config'
  | '@notesgraph/copilot-result'
  | '@notesgraph/doc-diff'
  | '@notesgraph/link-card-server'
  | '@notesgraph/plugin-server'
  | '@notesgraph/playstore-auto-bump'
  | '@notesgraph/revert-update'
  | '@notesgraph-tools/utils';
