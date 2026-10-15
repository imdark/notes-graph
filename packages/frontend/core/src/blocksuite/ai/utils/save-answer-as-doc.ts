import type { Workspace } from '@blocksuite/notesgraph/store';
import { MarkdownTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { getNotesGraphWorkspaceSchema } from '@notesgraph/core/modules/workspace';

import {
  type AnswerSource,
  answerToNoteMarkdown,
  deriveNoteTitle,
} from './answer-to-note';

/**
 * Where the markdown importer's `docLinkBaseURLMiddleware` expects links to
 * this workspace's notes, so a link there is imported as a doc reference.
 */
const workspaceDocUrl =
  (workspaceId: string) => (docId: string, blockId?: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '.';
    const base = `${origin}/workspace/${workspaceId}/${docId}`;
    return blockId ? `${base}?blockIds=${encodeURIComponent(blockId)}` : base;
  };

/**
 * Saves an AI answer as a new note in the workspace, its citations turned
 * into links: cited notes into doc references (so the new note shows in
 * their backlinks) and web citations into URLs. Returns the new note's id.
 */
export async function saveAnswerAsDoc(
  collection: Workspace,
  answer: string,
  options: {
    /** The title, when not the answer's own heading or first line. */
    title?: string;
    /** Notes the answer came from without citing them. */
    sources?: AnswerSource[];
  } = {}
): Promise<string | undefined> {
  const derived = deriveNoteTitle(answer);
  const markdown = answerToNoteMarkdown(derived.body, {
    docUrl: workspaceDocUrl(collection.id),
    docTitle: docId => collection.meta.getDocMeta(docId)?.title || undefined,
    sources: options.sources,
  });
  return MarkdownTransformer.importMarkdownToDoc({
    collection,
    schema: getNotesGraphWorkspaceSchema(),
    markdown,
    fileName: options.title || derived.title || undefined,
    extensions: getStoreManager().config.init().value.get('store'),
  });
}
