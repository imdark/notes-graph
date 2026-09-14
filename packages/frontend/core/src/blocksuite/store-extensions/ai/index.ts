import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
// Import the block SCHEMAS directly from their model files, NOT the
// `ai/blocks` barrel — the barrel re-exports the heavy AI chat UI/specs, which
// would drag the ~9MB AI bundle into doc CRUD (this store extension runs at
// bootstrap). CRUD only needs the schemas to load docs that contain AI blocks.
import { AIChatBlockSchemaExtension } from '@notesgraph/core/blocksuite/ai/blocks/ai-chat-block/model/ai-chat-model';
import { TranscriptionBlockSchemaExtension } from '@notesgraph/core/blocksuite/ai/blocks/transcription-block/model';

export class AIStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-store-extensions';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(AIChatBlockSchemaExtension);
    context.register(TranscriptionBlockSchemaExtension);
  }
}
