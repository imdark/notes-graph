import type { TestNotesGraphEditorContainer } from '@blocksuite/integration-test';
import type * as Effect from '@blocksuite/notesgraph/effects';
import type { EditorHost } from '@blocksuite/notesgraph/std';
import type {
  Store,
  Transformer,
  Workspace,
} from '@blocksuite/notesgraph/store';

declare type _GLOBAL_ = typeof Effect;

declare global {
  interface Window {
    /** Available on playground window
     * the following instance are initialized in `packages/playground/apps/starter/main.ts`
     */
    $blocksuite: {
      store: typeof import('@blocksuite/notesgraph/store');
      blocks: {
        database: typeof import('@blocksuite/notesgraph/blocks/database');
        note: typeof import('@blocksuite/notesgraph/blocks/note');
      };
      global: {
        utils: typeof import('@blocksuite/notesgraph/global/utils');
      };
      services: typeof import('@blocksuite/notesgraph/shared/services');
      editor: typeof import('@blocksuite/integration-test');
      blockStd: typeof import('@blocksuite/notesgraph/std');
      notesgraphModel: typeof import('@blocksuite/notesgraph-model');
    };
    collection: Workspace;
    doc: Store;
    editor: TestNotesGraphEditorContainer;
    host: EditorHost;
    job: Transformer;
  }
}
