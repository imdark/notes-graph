import { omit } from 'lodash-es';
import { z } from 'zod';

import type { PermissionAccess } from '../../../core/permission';
import {
  type ChunkSimilarity,
  clearEmbeddingChunk,
  type DocChunkSimilarity,
  type Models,
} from '../../../models';
import type { IndexerService } from '../../indexer';
import { CopilotContextService } from '../context/service';
import {
  resolveSearchScope,
  SEARCH_FILTER_OVERFETCH,
  SEARCH_FILTER_SYNTAX,
} from '../search-filter';
import {
  matchesWordFilters,
  parseSearchQuery,
  searchText,
} from '../search-query';
import { workspaceSyncRequiredError } from './doc-sync';
import { toolError } from './error';
import { defineTool } from './tool';
import type { CopilotChatOptions } from './types';

const SEMANTIC_SEARCH_TOP_K = 10;

const getEmbeddingRouteContext = (options: CopilotChatOptions) => ({
  userId: options?.user,
  byokLeaseId: options?.byokLeaseId,
});

/**
 * @param indexer resolves tag:/prop: filters; omit when the indexer is
 *   disabled, and those filters fail with an explanation.
 */
export const buildDocSearchGetter = (
  ac: PermissionAccess,
  context: CopilotContextService,
  sessionId: string | undefined,
  models: Models,
  indexer?: IndexerService
) => {
  const searchDocs = async (
    options: CopilotChatOptions,
    query?: string,
    signal?: AbortSignal
  ) => {
    if (!options || !query?.trim() || !options.user || !options.workspace) {
      return toolError(
        'Doc Semantic Search Failed',
        'Missing workspace, user, or query for doc_semantic_search.'
      );
    }
    const workspace = await models.workspace.get(options.workspace);
    if (!workspace) {
      return workspaceSyncRequiredError();
    }
    const canAccess = await ac
      .user(options.user)
      .workspace(options.workspace)
      .can('Workspace.Read');
    if (!canAccess)
      return toolError(
        'Doc Semantic Search Failed',
        'You do not have permission to access this workspace.'
      );
    const routeContext = getEmbeddingRouteContext(options);
    const filters = parseSearchQuery(query);
    const text = searchText(filters);
    if (!text) {
      return toolError(
        'Doc Semantic Search Failed',
        'The query needs search text (or a +"word") besides its filters.'
      );
    }
    // tag/prop/doc/date filters narrow the search to workspace docs
    const scope = await resolveSearchScope(
      { models, indexer },
      options.workspace,
      filters
    );
    const wordFiltered =
      filters.include.length > 0 || filters.exclude.length > 0;
    const topK = wordFiltered
      ? SEMANTIC_SEARCH_TOP_K * SEARCH_FILTER_OVERFETCH
      : SEMANTIC_SEARCH_TOP_K;
    const byWords = <T extends ChunkSimilarity>(items: T[]) =>
      wordFiltered
        ? items
            .filter(c => matchesWordFilters(filters, c.content))
            .slice(0, SEMANTIC_SEARCH_TOP_K)
        : items;

    const [chunks, contextChunks] = await Promise.all([
      scope
        ? context.matchWorkspaceDocs(
            options.workspace,
            text,
            topK,
            signal,
            0.8,
            routeContext,
            scope
          )
        : context.matchWorkspaceAll(
            options.workspace,
            text,
            topK,
            signal,
            0.8,
            undefined,
            0.85,
            routeContext
          ),
      sessionId && !scope
        ? context
            .getBySessionId(sessionId)
            .then(
              current =>
                current?.matchFiles(
                  text,
                  topK,
                  signal,
                  0.85,
                  0.5,
                  routeContext
                ) ?? []
            )
        : [],
    ]);

    const filteredChunks = byWords(chunks as ChunkSimilarity[]);
    const docChunks = await ac
      .user(options.user)
      .workspace(options.workspace)
      .docs(
        filteredChunks.filter((c): c is DocChunkSimilarity => 'docId' in c),
        'Doc.Read'
      );
    const blobChunks = filteredChunks.filter(c => 'blobId' in c);
    const fileChunks = filteredChunks.filter(c => 'fileId' in c);
    if (contextChunks.length) {
      fileChunks.push(...byWords(contextChunks));
    }
    if (!blobChunks.length && !docChunks.length && !fileChunks.length) {
      return [];
    }

    const docIds = docChunks.map(c => ({
      // oxlint-disable-next-line no-non-null-assertion
      workspaceId: options.workspace!,
      docId: c.docId,
    }));
    const docAuthors = await models.doc
      .findAuthors(docIds)
      .then(
        docs =>
          new Map(
            docs
              .filter(d => !!d)
              .map(doc => [doc.id, omit(doc, ['id', 'workspaceId'])])
          )
      );
    const docMetas = await models.doc
      .findMetas(docIds, { select: { title: true } })
      .then(
        docs =>
          new Map(
            docs
              .filter(d => !!d)
              .map(doc => [
                doc.docId,
                Object.assign({}, doc, docAuthors.get(doc.docId)),
              ])
          )
      );

    return [
      ...fileChunks.map(clearEmbeddingChunk),
      ...blobChunks.map(clearEmbeddingChunk),
      ...docChunks.map(c => ({
        ...c,
        ...docMetas.get(c.docId),
      })),
    ] as ChunkSimilarity[];
  };
  return searchDocs;
};

export const createDocSemanticSearchTool = (
  searchDocs: (
    query: string,
    signal?: AbortSignal
  ) => Promise<ChunkSimilarity[] | ReturnType<typeof toolError>>
) => {
  return defineTool({
    description: `Retrieve conceptually related passages by performing vector-based semantic similarity search across embedded documents; use this tool only when exact keyword search fails or the user explicitly needs meaning-level matches (e.g., paraphrases, synonyms, broader concepts, recent documents). ${SEARCH_FILTER_SYNTAX} Filters other than +/- words search workspace docs only, not attached files.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'The query statement to search for, e.g. "What is the capital of France?"\nWhen querying specific terms or IDs, you should provide the complete string instead of separating it with delimiters.\nFor example, if a user wants to look up the ID "sicDoe1is", use "What is sicDoe1is" instead of "si code 1is".'
        ),
    }),
    execute: async ({ query }, options) => {
      try {
        return await searchDocs(query, options.signal);
      } catch (e: any) {
        return toolError('Doc Semantic Search Failed', e.message);
      }
    },
  });
};
