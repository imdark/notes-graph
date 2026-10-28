import { Injectable, Logger } from '@nestjs/common';

import { DocReader } from '../../../../core/doc';
import { PermissionAccess } from '../../../../core/permission';

/** Most of the open document put in the prompt; the rest is a doc_read away. */
export const MAX_CURRENT_DOC_CHARS = 30_000;

/** The open document as prompt params, clipped to fit beside the chat. */
export function currentDocPromptParams(doc: {
  title: string;
  markdown: string;
}): { currentDocTitle: string; currentDocContent: string } {
  const markdown = doc.markdown.trim();
  return {
    currentDocTitle: doc.title.trim() || 'Untitled',
    currentDocContent:
      markdown.length > MAX_CURRENT_DOC_CHARS
        ? `${markdown.slice(0, MAX_CURRENT_DOC_CHARS)}\n\n… (cut; call doc_read for the rest)`
        : markdown,
  };
}

/**
 * The document the user is chatting beside, read into the chat prompt
 * ("Chat With NotesGraph AI" <current_document_context>). Given only its id,
 * a model that skipped doc_read answered about the id instead of the page.
 */
@Injectable()
export class CurrentDocHost {
  private readonly logger = new Logger(CurrentDocHost.name);

  constructor(
    private readonly reader: DocReader,
    private readonly ac: PermissionAccess
  ) {}

  async promptParams(
    userId: string,
    workspaceId: string,
    docId: unknown
  ): Promise<Partial<ReturnType<typeof currentDocPromptParams>>> {
    if (typeof docId !== 'string' || !docId.trim()) return {};
    try {
      const readable = await this.ac
        .user(userId)
        .workspace(workspaceId)
        .doc(docId)
        .can('Doc.Read');
      if (!readable) return {};
      const doc = await this.reader.getDocMarkdown(workspaceId, docId, false);
      return doc ? currentDocPromptParams(doc) : {};
    } catch (err) {
      // The chat still works without it: the prompt falls back to doc_read.
      this.logger.warn(
        `could not read current doc ${workspaceId}/${docId}: ${(err as Error).message}`
      );
      return {};
    }
  }
}
