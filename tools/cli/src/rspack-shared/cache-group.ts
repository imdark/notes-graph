function testPackageName(regexp: RegExp): (module: any) => boolean {
  return (module: any) =>
    module.nameForCondition && regexp.test(module.nameForCondition());
}

// https://hackernoon.com/the-100-correct-way-to-split-your-chunks-with-webpack-f8a9df5b7758
export const productionCacheGroups = {
  i18n: {
    test: /frontend[\\/]i18n[\\/]/,
    name: (module: any) => {
      const name = module.resource.match(/[\\/]([^\\/]+)\.json$/)?.[1];
      if (name && name !== 'en') {
        return `i18n-langs.${name}`;
      }

      return 'i18n';
    },
    priority: 200,
    enforce: true,
  },
  asyncVendor: {
    test: /[\\/]node_modules[\\/]/,
    name(module: any) {
      const modulePath =
        module?.nameForCondition?.() || module?.context || module?.resource;

      if (!modulePath || typeof modulePath !== 'string') {
        return 'app-async';
      }

      // monorepo linked in node_modules, so it's not a npm package
      if (!modulePath.includes('node_modules')) {
        return `app-async`;
      }
      const name = modulePath.match(
        /[\\/]node_modules[\\/](.*?)([\\/]|$)/
      )?.[1];
      return `npm-async-${name}`;
    },
    priority: Number.MAX_SAFE_INTEGER,
    chunks: 'async' as const,
  },
  blocksuite: {
    name: `npm-blocksuite`,
    test: testPackageName(/[\\/]node_modules[\\/](@blocksuite)[\\/]/),
    priority: 200,
    enforce: true,
  },
  // The AI/copilot feature (blocksuite/ai) is ~9MB and not needed for first
  // paint. Isolate it into its own chunk so it loads only when something that
  // uses it (editor AI extension, chat tab/page, AI peek view) is opened.
  //
  // The exclusion list keeps the LIGHT leaves that the bootstrap graph
  // legitimately needs synchronously (block schemas for doc CRUD, markdown
  // extraction, the copilot request runtime) OUT of this chunk: if any module
  // inside the chunk were statically required by the initial graph, rspack
  // would mark the entire ~9MB chunk as initial and it would load eagerly.
  blocksuiteAi: {
    name: 'app-ai',
    test: (module: any) => {
      const name = module.nameForCondition?.();
      if (
        !name ||
        !/packages[\\/]frontend[\\/]core[\\/]src[\\/]blocksuite[\\/]ai[\\/]/.test(
          name
        )
      ) {
        return false;
      }
      return !/[\\/]blocksuite[\\/]ai[\\/](blocks[\\/]ai-chat-block[\\/]model[\\/]|blocks[\\/]ai-chat-block[\\/]ai-transcription-block\.ts|blocks[\\/]transcription-block[\\/]model\.ts|components[\\/](text-renderer|page-editor-block-specs)\.ts|utils[\\/](extract|attachment|image|selection-utils|get-edgeless-copilot-widget)\.ts|widgets[\\/]edgeless-copilot[\\/]constant\.ts|runtime[\\/]request[\\/]|provider[\\/](event-source|error)\.ts)/.test(
        name
      );
    },
    chunks: 'all' as const,
    priority: 300,
    enforce: true,
    reuseExistingChunk: true,
  },
  react: {
    name: `npm-react`,
    test: testPackageName(
      /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/
    ),
    priority: 200,
    enforce: true,
  },
  jotai: {
    name: `npm-jotai`,
    test: testPackageName(/[\\/]node_modules[\\/](jotai)[\\/]/),
    priority: 200,
    enforce: true,
  },
  rxjs: {
    name: `npm-rxjs`,
    test: testPackageName(/[\\/]node_modules[\\/]rxjs[\\/]/),
    priority: 200,
    enforce: true,
  },
  lodash: {
    name: `npm-lodash`,
    test: testPackageName(/[\\/]node_modules[\\/]lodash[\\/]/),
    priority: 200,
    enforce: true,
  },
  emotion: {
    name: `npm-emotion`,
    test: testPackageName(/[\\/]node_modules[\\/](@emotion)[\\/]/),
    priority: 200,
    enforce: true,
  },
  vendor: {
    name: 'vendor',
    test: /[\\/]node_modules[\\/]/,
    priority: 190,
    enforce: true,
  },
  styles: {
    name: 'styles',
    test: (module: any) =>
      module.nameForCondition &&
      module.nameForCondition()?.endsWith('.css') &&
      !module.type.startsWith('javascript'),
    chunks: 'all' as const,
    minSize: 1,
    minChunks: 1,
    reuseExistingChunk: true,
    priority: 1000,
    enforce: true,
  },
};
