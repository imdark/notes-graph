import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { DocReader } from '../../../core/doc';
import { PermissionAccess } from '../../../core/permission';
import { Models } from '../../../models';
import {
  buildOutline,
  loadOutlineSource,
  type OutlineSource,
  readSection,
} from '../mcp/outline';
import {
  documentSyncPendingError,
  workspaceSyncRequiredError,
} from './doc-sync';
import { type ToolError, toolError } from './error';
import { defineTool } from './tool';
import type { CopilotChatOptions } from './types';

const logger = new Logger('DocOutlineTool');

const isToolError = (result: ToolError | object): result is ToolError =>
  'type' in result && result.type === 'error';

/** Loads a doc's outline source, with the same checks as doc_read. */
export const buildDocOutlineGetter = (
  ac: PermissionAccess,
  docReader: DocReader,
  models: Models
) => {
  return async (
    options: CopilotChatOptions,
    docId?: string
  ): Promise<OutlineSource | ToolError> => {
    if (!options?.user || !options?.workspace || !docId) {
      return toolError(
        'Doc Outline Failed',
        'Missing workspace, user, or document id.'
      );
    }

    const workspace = await models.workspace.get(options.workspace);
    if (!workspace) {
      return workspaceSyncRequiredError();
    }

    const canAccess = await ac
      .user(options.user)
      .workspace(options.workspace)
      .doc(docId)
      .can('Doc.Read');
    if (!canAccess) {
      return toolError(
        'Doc Outline Failed',
        `You do not have permission to read document ${docId} in this workspace.`
      );
    }

    const source = await loadOutlineSource(docReader, options.workspace, docId);
    return source ?? documentSyncPendingError(docId);
  };
};

type OutlineGetter = (docId?: string) => Promise<OutlineSource | ToolError>;

export const createDocOutlineTool = (getSource: OutlineGetter) => {
  return defineTool({
    description:
      "Return a document's heading tree without its body: each heading's block_id, level (1-6), title, parent heading and section size (characters and top-level blocks, sub-sections included), plus the size of any intro before the first heading. Use this first on a long document, then doc_read_section the sections that matter instead of reading the whole document with doc_read.",
    inputSchema: z.object({
      doc_id: z.string().describe('The target doc to outline'),
    }),
    execute: async ({ doc_id }) => {
      try {
        const source = await getSource(doc_id);
        if (isToolError(source)) return source;
        return {
          docId: doc_id,
          title: source.title,
          ...buildOutline(source.markdown, source.headings),
        };
      } catch (err: any) {
        logger.error(`Failed to outline the doc ${doc_id}`, err);
        return toolError('Doc Outline Failed', err.message ?? String(err));
      }
    },
  });
};

export const createDocReadSectionTool = (getSource: OutlineGetter) => {
  return defineTool({
    description:
      "Read one section of a document as markdown: the heading at block_id (from doc_outline) with its content and sub-sections, up to the next heading of the same or a higher level. Pass the outline's intro block_id to read the content before the first heading. Each block is preceded by its `<!-- block_id=… flavour=… -->` comment.",
    inputSchema: z.object({
      doc_id: z.string().describe('The target doc'),
      block_id: z
        .string()
        .describe(
          "A heading's blockId from doc_outline (or its intro blockId)"
        ),
    }),
    execute: async ({ doc_id, block_id }) => {
      try {
        const source = await getSource(doc_id);
        if (isToolError(source)) return source;
        const section = readSection(source.markdown, source.headings, block_id);
        if (!section) {
          return toolError(
            'Doc Read Section Failed',
            `Document ${doc_id} has no top-level block ${block_id}; get heading block ids from doc_outline.`
          );
        }
        return { docId: doc_id, title: source.title, ...section };
      } catch (err: any) {
        logger.error(`Failed to read a section of the doc ${doc_id}`, err);
        return toolError('Doc Read Section Failed', err.message ?? String(err));
      }
    },
  });
};
