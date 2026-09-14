import { NotesGraphSchemas } from '@blocksuite/notesgraph/schemas';
import { Schema } from '@blocksuite/notesgraph/store';
import { AIChatBlockSchema } from '@notesgraph/core/blocksuite/ai/blocks/ai-chat-block/model';
import { TranscriptionBlockSchema } from '@notesgraph/core/blocksuite/ai/blocks/transcription-block/model';

let _schema: Schema | null = null;
export function getNotesGraphWorkspaceSchema() {
  if (!_schema) {
    _schema = new Schema();

    _schema.register([
      ...NotesGraphSchemas,
      AIChatBlockSchema,
      TranscriptionBlockSchema,
    ]);
  }

  return _schema;
}
