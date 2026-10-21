import { Injectable } from '@nestjs/common';
import { pick } from 'lodash-es';
import z from 'zod/v3';

import { DocReader, DocWriter } from '../../../core/doc';
import { PermissionAccess } from '../../../core/permission';
import { clearEmbeddingChunk, Models } from '../../../models';
import { IndexerService } from '../../indexer';
import { SearchTable } from '../../indexer/tables';
import {
  type SearchInput,
  SearchQueryOccur,
  SearchQueryType,
} from '../../indexer/types';
import { CopilotContextService } from '../context/service';
import {
  filterDocIdsByDates,
  resolveSearchScope,
  resolveWordDocIds,
  SEARCH_FILTER_OVERFETCH,
  SEARCH_FILTER_SYNTAX,
  tokenList,
} from '../search-filter';
import {
  matchesWordFilters,
  parseSearchQuery,
  searchText,
} from '../search-query';
import {
  CanvasError,
  canvasSvg,
  describeItem,
  type DrawItem,
  drawOnCanvas,
  intersects,
  readCanvas,
  svgToPng,
} from './canvas';
import { applyBudget, fuseRanked } from './rrf';
import { findSecret, guardSecrets, secretRefusal } from './secret-guard';
import {
  DEFAULT_STALE_DAYS,
  DEFAULT_STUB_CHARS,
  notesHealth,
} from './notes-health';
import {
  buildOutline,
  loadOutlineSource,
  type OutlineSource,
  readSection,
} from './outline';

function first(value: unknown): string {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === 'string' ? item : '';
}

const SEMANTIC_SEARCH_TOP_K = 5;
const KEYWORD_SEARCH_LIMIT = 20;
const HYBRID_DEFAULT_ITEMS = 8;
const HYBRID_DEFAULT_CHARS = 6000;

type McpTextContent = {
  type: 'text';
  text: string;
};

type McpImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type WorkspaceMcpToolResult = {
  content: (McpTextContent | McpImageContent)[];
  isError?: boolean;
};

export type WorkspaceMcpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    options: { signal: AbortSignal }
  ) => Promise<WorkspaceMcpToolResult>;
};

export type WorkspaceMcpServer = {
  name: string;
  version: string;
  tools: WorkspaceMcpToolDefinition[];
};

type ToolExecutorInput<T extends z.ZodTypeAny> = {
  name: string;
  title: string;
  description: string;
  parser: T;
  inputSchema: Record<string, unknown>;
  execute: (
    args: z.infer<T>,
    options: { signal: AbortSignal }
  ) => Promise<WorkspaceMcpToolResult>;
};

function toolText(text: string): WorkspaceMcpToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

function toolError(message: string): WorkspaceMcpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function toInputError(error: z.ZodError) {
  const details = error.issues
    .map(issue => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
  return toolError(`Invalid arguments: ${details || 'Invalid input'}`);
}

/** The diagram types Mermaid draws, as a diagram's first word. */
const MERMAID_DIAGRAMS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'journey',
  'quadrantChart',
  'gitGraph',
  'xychart-beta',
];

/**
 * The Mermaid source an agent passed, ready for a ```mermaid fence, or why
 * it can't be drawn. Only the shape is checked: a fence it was wrapped in is
 * taken off, and its first word must name a diagram type.
 */
export function mermaidSource(input: string): string | { error: string } {
  const source = input
    .trim()
    .replace(/^```\s*mermaid[^\n]*\n/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  if (!source) return { error: 'The Mermaid source is empty.' };
  if (/^```/m.test(source)) {
    return { error: 'The Mermaid source cannot contain a ``` fence.' };
  }
  // Front matter (---) and %% directives may come before the diagram type.
  const first = source
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('%%'));
  const keyword = first?.split(/[\s:;{]/)[0] ?? '';
  if (!MERMAID_DIAGRAMS.includes(keyword)) {
    return {
      error: `The Mermaid source must start with a diagram type (${MERMAID_DIAGRAMS.slice(0, 12).join(', ')}); it starts with "${keyword.slice(0, 40)}".`,
    };
  }
  return source;
}

function abortIfNeeded(
  signal: AbortSignal
): WorkspaceMcpToolResult | undefined {
  if (signal.aborted) return toolError('Request aborted.');
  return;
}

function defineTool<T extends z.ZodTypeAny>(
  config: ToolExecutorInput<T>
): WorkspaceMcpToolDefinition {
  return {
    name: config.name,
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: async (args, options) => {
      const aborted = abortIfNeeded(options.signal);
      if (aborted) return aborted;

      const parsed = config.parser.safeParse(args ?? {});
      if (!parsed.success) return toInputError(parsed.error);
      return await config.execute(parsed.data, options);
    },
  };
}

@Injectable()
export class WorkspaceMcpProvider {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly reader: DocReader,
    private readonly writer: DocWriter,
    private readonly context: CopilotContextService,
    private readonly indexer: IndexerService,
    private readonly models: Models
  ) {}

  async for(userId: string, workspaceId: string): Promise<WorkspaceMcpServer> {
    await this.ac.user(userId).workspace(workspaceId).assert('Workspace.Read');

    const readDocument = defineTool({
      name: 'read_document',
      title: 'Read Document',
      description: 'Read a document with given ID',
      parser: z.object({ docId: z.string() }),
      inputSchema: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
        },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId }, options) => {
        const notFoundError = toolError(`Doc with id ${docId} not found.`);

        const accessible = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(docId)
          .can('Doc.Read');
        if (!accessible) return notFoundError;

        const abortedAfterPermission = abortIfNeeded(options.signal);
        if (abortedAfterPermission) return abortedAfterPermission;

        const content = await this.reader.getDocMarkdown(
          workspaceId,
          docId,
          false
        );
        if (!content) return notFoundError;

        const abortedAfterRead = abortIfNeeded(options.signal);
        if (abortedAfterRead) return abortedAfterRead;

        return toolText(content.markdown);
      },
    });

    const semanticSearch = defineTool({
      name: 'semantic_search',
      title: 'Semantic Search',
      description: `Retrieve conceptually related passages by performing vector-based semantic similarity search across embedded documents; use this tool only when exact keyword search fails or the user explicitly needs meaning-level matches (e.g., paraphrases, synonyms, broader concepts, recent documents). Pass docId to scope matching to a single document. ${SEARCH_FILTER_SYNTAX} Example: deploy steps tag:work dt>=2026-01-01 -"staging".`,
      parser: z.object({ query: z.string(), docId: z.string().optional() }),
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search text, optionally with filters: tag:x prop:k:v doc:"Title" dt>=YYYY-MM-DD dt<=YYYY-MM-DD +"word" -"word".',
          },
          docId: {
            type: 'string',
            description:
              'Optional document id — only match passages from this document.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async ({ query, docId }, options) => {
        const filters = parseSearchQuery(query);
        const text = searchText(filters);
        if (!text) {
          return toolError(
            'Semantic search needs search text (or a +"word") besides its filters.'
          );
        }

        let scope = await resolveSearchScope(
          { models: this.models, indexer: this.indexer },
          workspaceId,
          filters
        );
        if (docId) {
          scope = {
            ...scope,
            docIds: scope?.docIds
              ? scope.docIds.filter(id => id === docId)
              : [docId],
          };
        }

        const wordFiltered =
          filters.include.length > 0 || filters.exclude.length > 0;
        const chunks = await this.context.matchWorkspaceDocs(
          workspaceId,
          text,
          wordFiltered
            ? SEMANTIC_SEARCH_TOP_K * SEARCH_FILTER_OVERFETCH
            : SEMANTIC_SEARCH_TOP_K,
          options.signal,
          undefined,
          undefined,
          scope
        );

        const abortedAfterMatch = abortIfNeeded(options.signal);
        if (abortedAfterMatch) return abortedAfterMatch;

        const matched = chunks
          .filter(chunk => 'docId' in chunk)
          .filter(chunk => matchesWordFilters(filters, chunk.content))
          .slice(0, SEMANTIC_SEARCH_TOP_K);
        const docs = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(matched, 'Doc.Read');

        const abortedAfterDocs = abortIfNeeded(options.signal);
        if (abortedAfterDocs) return abortedAfterDocs;

        if (!docs || docs.length === 0) {
          return toolText('No matching documents found.');
        }

        return {
          content: docs.map(doc => ({
            type: 'text',
            text: clearEmbeddingChunk(doc).content,
          })),
        };
      },
    });

    const keywordSearch = defineTool({
      name: 'keyword_search',
      title: 'Keyword Search',
      description: `Fuzzy search all workspace documents for the exact keyword or phrase supplied and return matching documents ranked by textual match. Use this tool by default whenever a straightforward term-based or keyword-base lookup is sufficient. For block-level hits, or to search inside one document, use search_blocks instead. ${SEARCH_FILTER_SYNTAX} Example: release notes prop:status:done doc:"Roadmap" +"v2".`,
      parser: z.object({ query: z.string() }),
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Keywords, optionally with filters: tag:x prop:k:v doc:"Title" dt>=YYYY-MM-DD dt<=YYYY-MM-DD +"word" -"word".',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async ({ query }, options) => {
        const filters = parseSearchQuery(query);
        const text = searchText(filters);
        if (!text) {
          return toolError(
            'Keyword search needs keywords (or a +"word") besides its filters.'
          );
        }

        const deps = { models: this.models, indexer: this.indexer };
        const [scope, words] = await Promise.all([
          resolveSearchScope(deps, workspaceId, filters),
          resolveWordDocIds(deps, workspaceId, filters),
        ]);
        let docIds = scope?.docIds;
        if (words.include) {
          const include = words.include;
          docIds = docIds ? docIds.filter(id => include.has(id)) : [...include];
        }
        const postFiltered = filters.dates.length > 0 || words.exclude.size > 0;

        let docs = await this.indexer.searchDocsByKeyword(workspaceId, text, {
          docIds,
          limit: postFiltered
            ? KEYWORD_SEARCH_LIMIT * SEARCH_FILTER_OVERFETCH
            : KEYWORD_SEARCH_LIMIT,
        });
        docs = docs.filter(doc => !words.exclude.has(doc.docId));
        if (filters.dates.length) {
          const inRange = await filterDocIdsByDates(
            this.models,
            workspaceId,
            docs.map(doc => doc.docId),
            filters
          );
          docs = docs.filter(doc => inRange.has(doc.docId));
        }
        docs = docs.slice(0, KEYWORD_SEARCH_LIMIT);

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        docs = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(docs, 'Doc.Read');

        const abortedAfterDocs = abortIfNeeded(options.signal);
        if (abortedAfterDocs) return abortedAfterDocs;

        if (!docs || docs.length === 0) {
          return toolText('No matching documents found.');
        }

        return {
          content: docs.map(doc => ({
            type: 'text',
            text: JSON.stringify(pick(doc, 'docId', 'title', 'createdAt')),
          })),
        };
      },
    });

    const searchBlocks = defineTool({
      name: 'search_blocks',
      title: 'Search Blocks',
      description:
        'Full-text search over individual blocks (paragraphs, list items, headings — any content block) and return blockId-level hits with their text. Unlike keyword_search this pinpoints the matching block, not just the document; pass docId to search inside a single document. To act on a hit, read_document its docId and update_document the matching line.',
      parser: z.object({
        query: z.string(),
        docId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          docId: {
            type: 'string',
            description:
              'Optional document id — only search blocks inside this document.',
          },
          limit: {
            type: 'number',
            description: 'Max blocks to return (default 20, max 100).',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor from a previous call, if any.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async ({ query, docId, limit, cursor }, options) => {
        const trimmed = query.trim();
        if (!trimmed) return toolError('Query is required for block search.');

        const result = await this.indexer.search({
          table: SearchTable.block,
          query: {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.must,
            queries: [
              {
                type: SearchQueryType.match,
                field: 'workspaceId',
                match: workspaceId,
              },
              ...(docId
                ? [
                    {
                      type: SearchQueryType.match,
                      field: 'docId',
                      match: docId,
                    },
                  ]
                : []),
              {
                type: SearchQueryType.match,
                field: 'content',
                match: trimmed,
              },
            ],
          },
          options: {
            fields: [
              'docId',
              'blockId',
              'flavour',
              'content',
              'orgStatus',
              'tags',
              'props',
              'todoTrail',
            ],
            pagination: { limit: Math.min(limit ?? 20, 100), cursor },
          },
        });

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const candidates = result.nodes
          .map(node => {
            const tags = tokenList(node.fields.tags);
            const props = tokenList(node.fields.props);
            return {
              docId: first(node.fields.docId),
              blockId: first(node.fields.blockId),
              flavour: first(node.fields.flavour),
              text: first(node.fields.content),
              status: first(node.fields.orgStatus) || undefined,
              tags: tags.length ? tags : undefined,
              props: props.length ? props : undefined,
              trail: first(node.fields.todoTrail) || undefined,
            };
          })
          .filter(block => block.text && (!docId || block.docId === docId));

        // permission filter by owning doc
        const docIds = [...new Set(candidates.map(block => block.docId))];
        const readable = new Set<string>();
        for (const id of docIds) {
          const canRead = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(id)
            .can('Doc.Read');
          if (canRead) readable.add(id);
        }

        const abortedAfterFilter = abortIfNeeded(options.signal);
        if (abortedAfterFilter) return abortedAfterFilter;

        return toolText(
          JSON.stringify({
            blocks: candidates.filter(block => readable.has(block.docId)),
            nextCursor: result.nextCursor,
          })
        );
      },
    });

    const listDocuments = defineTool({
      name: 'list_documents',
      title: 'List Documents',
      description:
        'List documents in the workspace (id, title, created/updated timestamps), newest-updated first. Use this to get an overview of the workspace or page through it — this is the starting point for exploring a graph you have no query terms for yet.',
      parser: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max documents to return (default 50, max 200).',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor from a previous call, if any.',
          },
        },
        additionalProperties: false,
      },
      execute: async ({ limit, cursor }, options) => {
        const result = await this.indexer.search({
          table: SearchTable.doc,
          query: {
            type: SearchQueryType.match,
            field: 'workspaceId',
            match: workspaceId,
          },
          options: {
            fields: ['docId', 'title', 'createdAt', 'updatedAt'],
            pagination: { limit: limit ?? 50, cursor },
          },
        });

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const candidates = result.nodes.map(node => ({
          docId: first(node.fields.docId),
          title: first(node.fields.title) || 'Untitled',
          createdAt: first(node.fields.createdAt),
          updatedAt: first(node.fields.updatedAt),
        }));
        const readable = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(candidates, 'Doc.Read');

        const abortedAfterFilter = abortIfNeeded(options.signal);
        if (abortedAfterFilter) return abortedAfterFilter;

        return toolText(
          JSON.stringify({ documents: readable, nextCursor: result.nextCursor })
        );
      },
    });

    const listBlocks = defineTool({
      name: 'list_blocks',
      title: 'List Task Blocks',
      description:
        "Query individual task blocks (todo list items) across the whole workspace by their inline #tags, #key:value properties and org status — the block-level equivalent of list_documents. Returns each task's docId/blockId, text, status (todo | in-progress | done | custom keyword), tags, properties and org planning timestamps. To act on a task, read_document its docId and update_document the task line (see update_document for the org-mode workflow).",
      parser: z.object({
        tags: z.array(z.string()).optional(),
        props: z.array(z.string()).optional(),
        status: z.string().optional(),
        docId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          docId: {
            type: 'string',
            description:
              'Optional document id — only return tasks from this document.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Inline #tags the task must have (without '#', lowercase), e.g. ['personal']. All must match.",
          },
          props: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Inline #key:value properties the task must have (without '#', lowercase), e.g. ['project:atlas']. All must match.",
          },
          status: {
            type: 'string',
            description:
              "Filter by org status: 'todo' | 'in-progress' | 'done' | a custom keyword (kebab-case).",
          },
          limit: {
            type: 'number',
            description: 'Max tasks to return (default 50, max 200).',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor from a previous call, if any.',
          },
        },
        additionalProperties: false,
      },
      execute: async (
        { tags, props, status, docId, limit, cursor },
        options
      ) => {
        const result = await this.indexer.search({
          table: SearchTable.block,
          query: {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.must,
            queries: [
              {
                type: SearchQueryType.match,
                field: 'workspaceId',
                match: workspaceId,
              },
              {
                type: SearchQueryType.match,
                field: 'flavour',
                match: 'notesgraph:list',
              },
              ...(docId
                ? [
                    {
                      type: SearchQueryType.match,
                      field: 'docId',
                      match: docId,
                    },
                  ]
                : []),
              ...(tags ?? []).map(tag => ({
                type: SearchQueryType.match,
                field: 'tags',
                match: tag,
              })),
              ...(props ?? []).map(prop => ({
                type: SearchQueryType.match,
                field: 'props',
                match: prop,
              })),
            ],
          },
          options: {
            fields: [
              'docId',
              'blockId',
              'content',
              'orgStatus',
              'tags',
              'props',
              'todoTrail',
              'scheduledAt',
              'deadlineAt',
              'startedAt',
              'closedAt',
            ],
            pagination: { limit: Math.min(limit ?? 50, 200), cursor },
          },
        });

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const wantedTags = (tags ?? []).map(tag => tag.toLowerCase());
        const wantedProps = (props ?? []).map(prop => prop.toLowerCase());
        const candidates = result.nodes
          .map(node => ({
            docId: first(node.fields.docId),
            blockId: first(node.fields.blockId),
            text: first(node.fields.content),
            status: first(node.fields.orgStatus),
            tags: tokenList(node.fields.tags),
            props: tokenList(node.fields.props),
            trail: first(node.fields.todoTrail) || undefined,
            scheduledAt: first(node.fields.scheduledAt) || undefined,
            deadlineAt: first(node.fields.deadlineAt) || undefined,
            startedAt: first(node.fields.startedAt) || undefined,
            closedAt: first(node.fields.closedAt) || undefined,
          }))
          // only task blocks, with exactness re-checks: index matching can
          // be tokenized, so verify the tokens verbatim
          .filter(
            task =>
              task.status &&
              (!status || task.status === status) &&
              (!docId || task.docId === docId) &&
              wantedTags.every(tag => task.tags.includes(tag)) &&
              wantedProps.every(prop => task.props.includes(prop))
          );

        // permission filter by owning doc
        const docIds = [...new Set(candidates.map(task => task.docId))];
        const readable = new Set<string>();
        for (const docId of docIds) {
          const canRead = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Read');
          if (canRead) readable.add(docId);
        }

        const abortedAfterFilter = abortIfNeeded(options.signal);
        if (abortedAfterFilter) return abortedAfterFilter;

        return toolText(
          JSON.stringify({
            tasks: candidates.filter(task => readable.has(task.docId)),
            nextCursor: result.nextCursor,
          })
        );
      },
    });

    const getBoard = defineTool({
      name: 'get_board',
      title: 'Get Board',
      description:
        "Read the virtual kanban/table boards defined in a document: each board is a saved query (scope) over task blocks — inline #tags, #key:value props, org status slice, and an optional due-within-days bound. Combine the scope with list_blocks to fetch the board's tasks, then act on a task with update_task (pull into in-progress, add notes, move it through committed → merged → deployed → done as it ships). Find board documents with keyword_search or list_documents first.",
      parser: z.object({ docId: z.string() }),
      inputSchema: {
        type: 'object',
        properties: {
          docId: {
            type: 'string',
            description: 'The document containing the board(s)',
          },
        },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId }, options) => {
        const canRead = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(docId)
          .can('Doc.Read');
        if (!canRead) return toolError(`Doc with id ${docId} not found.`);

        const aborted = abortIfNeeded(options.signal);
        if (aborted) return aborted;

        try {
          const boards = await this.writer.getBoardScopes(workspaceId, docId);
          return toolText(
            JSON.stringify({
              boards,
              usage:
                boards.length > 0
                  ? "Fetch tasks with list_blocks using each board's tags/props (and status to slice by column); update a task with update_task."
                  : 'No query boards in this document. Boards are created in the editor via /query board, /query table or /task report.',
            })
          );
        } catch (error) {
          return toolError(
            `Failed to read boards: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      },
    });

    const getBacklinks = defineTool({
      name: 'get_backlinks',
      title: 'Get Backlinks',
      description:
        'List documents that link to the given document (its "parents" in the graph — NotesGraph has no single fixed parent, a doc can have several). Use this to understand where a document sits in the graph before you decide where to file something new.',
      parser: z.object({ docId: z.string() }),
      inputSchema: {
        type: 'object',
        properties: { docId: { type: 'string' } },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId }, options) => {
        const accessible = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(docId)
          .can('Doc.Read');
        if (!accessible) return toolError(`Doc with id ${docId} not found.`);

        const result = await this.indexer.aggregate({
          table: SearchTable.block,
          field: 'docId',
          query: {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.must,
            queries: [
              {
                type: SearchQueryType.match,
                field: 'workspaceId',
                match: workspaceId,
              },
              {
                type: SearchQueryType.match,
                field: 'refDocId',
                match: docId,
              },
            ],
          },
          options: { hits: { fields: [], pagination: { limit: 1 } } },
        });

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const candidates = result.buckets
          .filter(bucket => bucket.key !== docId)
          .map(bucket => ({ docId: bucket.key }));
        const readable = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(candidates, 'Doc.Read');
        const titled = await this.titlesFor(
          workspaceId,
          readable.map(d => d.docId)
        );

        const abortedAfterFilter = abortIfNeeded(options.signal);
        if (abortedAfterFilter) return abortedAfterFilter;

        return toolText(JSON.stringify({ backlinks: titled }));
      },
    });

    const getLinks = defineTool({
      name: 'get_links',
      title: 'Get Outbound Links',
      description:
        'List documents that the given document links to (its "children"/references). Use this together with get_backlinks to walk the graph outward from a starting document.',
      parser: z.object({ docId: z.string() }),
      inputSchema: {
        type: 'object',
        properties: { docId: { type: 'string' } },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId }, options) => {
        const accessible = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(docId)
          .can('Doc.Read');
        if (!accessible) return toolError(`Doc with id ${docId} not found.`);

        const result = await this.indexer.search({
          table: SearchTable.block,
          query: {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.must,
            queries: [
              {
                type: SearchQueryType.match,
                field: 'workspaceId',
                match: workspaceId,
              },
              {
                type: SearchQueryType.match,
                field: 'docId',
                match: docId,
              },
              { type: SearchQueryType.exists, field: 'refDocId' },
            ],
          },
          options: {
            fields: ['refDocId'],
            pagination: { limit: 200 },
          },
        });

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const linkedIds = new Set<string>();
        for (const node of result.nodes) {
          const values = node.fields.refDocId;
          const arr = Array.isArray(values) ? values : [values];
          for (const value of arr) {
            const id = typeof value === 'string' ? value : '';
            if (id && id !== docId) linkedIds.add(id);
          }
        }
        const candidates = [...linkedIds].map(id => ({ docId: id }));
        const readable = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(candidates, 'Doc.Read');
        const titled = await this.titlesFor(
          workspaceId,
          readable.map(d => d.docId)
        );

        const abortedAfterFilter = abortIfNeeded(options.signal);
        if (abortedAfterFilter) return abortedAfterFilter;

        return toolText(JSON.stringify({ links: titled }));
      },
    });

    const notesHealthTool = defineTool({
      name: 'notes_health',
      title: 'Notes Health',
      description:
        'Check the whole workspace for the problems a person tidying their notes would look for, computed from the search index rather than guessed: orphans (notes no other note links to; journal days excluded), brokenLinks (links to notes that no longer exist), duplicateTitles (notes whose titles have the same words, candidates to merge on the Duplicates page at duplicatesPath), stubs (notes with almost no body), and staleFacts (blocks stamped "as of <date>" longer ago than staleDays). It only reads; nothing is changed. Contradictions between notes need reading, so they are not in here.',
      parser: z.object({
        staleDays: z.number().int().min(1).max(3650).optional(),
        stubChars: z.number().int().min(1).max(2000).optional(),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          staleDays: {
            type: 'number',
            description: `An "as of" fact older than this many days is stale (default ${DEFAULT_STALE_DAYS}).`,
          },
          stubChars: {
            type: 'number',
            description: `A note whose body is shorter than this many characters is a stub (default ${DEFAULT_STUB_CHARS}).`,
          },
        },
        additionalProperties: false,
      },
      execute: async ({ staleDays, stubChars }, options) => {
        const inWorkspace = {
          type: SearchQueryType.match,
          field: 'workspaceId',
          match: workspaceId,
        };
        const docNodes = await this.searchAll({
          table: SearchTable.doc,
          query: inWorkspace,
          options: { fields: ['docId', 'title', 'summary', 'journal'] },
        });
        const linkNodes = await this.searchAll({
          table: SearchTable.block,
          query: {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.must,
            queries: [
              inWorkspace,
              { type: SearchQueryType.exists, field: 'refDocId' },
            ],
          },
          options: { fields: ['docId', 'refDocId'] },
        });
        // Narrowed by the index to blocks with both words; the date itself
        // is read from the text afterwards.
        const factNodes = await this.searchAll({
          table: SearchTable.block,
          query: {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.must,
            queries: [
              inWorkspace,
              { type: SearchQueryType.match, field: 'content', match: 'as' },
              { type: SearchQueryType.match, field: 'content', match: 'of' },
            ],
          },
          options: { fields: ['docId', 'blockId', 'content'] },
        });

        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const allDocs = docNodes.map(node => ({
          docId: first(node.fields.docId),
          title: first(node.fields.title),
          summary: first(node.fields.summary),
          journal: !!first(node.fields.journal),
        }));
        // Every indexed note counts as existing, so a link to one the user
        // can't read isn't reported as broken; only readable ones are reported.
        const readable = new Set(
          (
            await this.ac
              .user(userId)
              .workspace(workspaceId)
              .docs(allDocs, 'Doc.Read')
          ).map(doc => doc.docId)
        );
        const links = linkNodes.flatMap(node =>
          tokenList(node.fields.refDocId).map(toDocId => ({
            fromDocId: first(node.fields.docId),
            toDocId,
          }))
        );
        const report = notesHealth(
          {
            docs: allDocs,
            links,
            blocks: factNodes.map(node => ({
              docId: first(node.fields.docId),
              blockId: first(node.fields.blockId),
              text: first(node.fields.content),
            })),
          },
          { now: new Date(), staleDays, stubChars }
        );
        const canRead = (item: { docId: string }) => readable.has(item.docId);

        return toolText(
          JSON.stringify({
            orphans: report.orphans.filter(canRead),
            brokenLinks: report.brokenLinks.filter(link =>
              readable.has(link.fromDocId)
            ),
            duplicateTitles: report.duplicateTitles
              .map(group => ({ ...group, docs: group.docs.filter(canRead) }))
              .filter(group => group.docs.length > 1),
            stubs: report.stubs.filter(canRead),
            staleFacts: report.staleFacts.filter(canRead),
            duplicatesPath: `/workspace/${workspaceId}/duplicates`,
            notesChecked: readable.size,
          })
        );
      },
    });

    const loadOutline = async (
      docId: string,
      signal: AbortSignal
    ): Promise<OutlineSource | WorkspaceMcpToolResult> => {
      const notFoundError = toolError(`Doc with id ${docId} not found.`);
      const accessible = await this.ac
        .user(userId)
        .workspace(workspaceId)
        .doc(docId)
        .can('Doc.Read');
      if (!accessible) return notFoundError;
      const aborted = abortIfNeeded(signal);
      if (aborted) return aborted;
      const source = await loadOutlineSource(this.reader, workspaceId, docId);
      if (!source) return notFoundError;
      return abortIfNeeded(signal) ?? source;
    };

    const docOutline = defineTool({
      name: 'doc_outline',
      title: 'Document Outline',
      description:
        "Return a document's heading tree without its body: for each heading its blockId, level (1-6), title, parentBlockId (the enclosing heading) and the section's size (characters and top-level blocks, sub-sections included), plus the size of any intro before the first heading. Use it to skim a long note by structure, then read_section the parts that matter instead of loading the whole document with read_document. Heading blockIds also work with update_block.",
      parser: z.object({ docId: z.string() }),
      inputSchema: {
        type: 'object',
        properties: { docId: { type: 'string' } },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId }, options) => {
        const loaded = await loadOutline(docId, options.signal);
        if (!('markdown' in loaded)) return loaded;
        return toolText(
          JSON.stringify({
            docId,
            title: loaded.title,
            ...buildOutline(loaded.markdown, loaded.headings),
          })
        );
      },
    });

    const readDocSection = defineTool({
      name: 'read_section',
      title: 'Read Document Section',
      description:
        "Read one section of a document as markdown: the heading at blockId (from doc_outline) with its text and sub-sections, up to the next heading of the same or a higher level. Pass the outline's intro blockId to read the content before the first heading. Each block is preceded by a `<!-- block_id=… flavour=… -->` comment, so you can target a block with update_block / update_task.",
      parser: z.object({ docId: z.string(), blockId: z.string() }),
      inputSchema: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          blockId: {
            type: 'string',
            description:
              "A heading's blockId from doc_outline (or its intro blockId)",
          },
        },
        required: ['docId', 'blockId'],
        additionalProperties: false,
      },
      execute: async ({ docId, blockId }, options) => {
        const loaded = await loadOutline(docId, options.signal);
        if (!('markdown' in loaded)) return loaded;
        const section = readSection(loaded.markdown, loaded.headings, blockId);
        if (!section) {
          return toolError(
            `Doc ${docId} has no top-level block ${blockId}; get heading blockIds from doc_outline.`
          );
        }
        return toolText(section.markdown);
      },
    });

    const hybridSearch = defineTool({
      name: 'search',
      title: 'Search',
      description:
        'Search the workspace with keyword and semantic search together and fuse the two rankings (reciprocal rank fusion). Use this by default instead of choosing between keyword_search and semantic_search. Returns documents best-first with a passage; limit the output with maxItems and maxChars.',
      parser: z.object({
        query: z.string(),
        maxItems: z.number().int().min(1).max(30).optional(),
        maxChars: z.number().int().min(200).max(30000).optional(),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text.' },
          maxItems: {
            type: 'number',
            description: `Most documents to return (default ${HYBRID_DEFAULT_ITEMS}).`,
          },
          maxChars: {
            type: 'number',
            description: `Total passage characters to return (default ${HYBRID_DEFAULT_CHARS}).`,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (
        {
          query,
          maxItems = HYBRID_DEFAULT_ITEMS,
          maxChars = HYBRID_DEFAULT_CHARS,
        },
        options
      ) => {
        const text = query.trim();
        if (!text) return toolError('Search needs search text.');

        const [keywordDocs, chunks] = await Promise.all([
          this.indexer.searchDocsByKeyword(workspaceId, text, {
            limit: KEYWORD_SEARCH_LIMIT,
          }),
          this.context.matchWorkspaceDocs(
            workspaceId,
            text,
            SEMANTIC_SEARCH_TOP_K * 2,
            options.signal
          ),
        ]);
        const abortedAfterSearch = abortIfNeeded(options.signal);
        if (abortedAfterSearch) return abortedAfterSearch;

        const fused = fuseRanked([
          {
            source: 'keyword',
            hits: keywordDocs.map(doc => ({
              docId: doc.docId,
              title: doc.title,
            })),
          },
          {
            source: 'semantic',
            hits: chunks
              .filter(chunk => 'docId' in chunk)
              .map(chunk => ({
                docId: chunk.docId as string,
                text: clearEmbeddingChunk(chunk as any).content,
              })),
          },
        ]);
        const readable = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(fused, 'Doc.Read');
        const abortedAfterDocs = abortIfNeeded(options.signal);
        if (abortedAfterDocs) return abortedAfterDocs;

        const hits = applyBudget(readable ?? [], maxItems, maxChars);
        if (hits.length === 0) return toolText('No matching documents found.');
        return {
          content: hits.map(hit => ({
            type: 'text' as const,
            text: JSON.stringify({
              docId: hit.docId,
              title: hit.title,
              via: hit.sources,
              passage: hit.text,
            }),
          })),
        };
      },
    });

    /** The doc's canvas, or an error result when it can't be read. */
    const loadCanvas = async (docId: string, signal: AbortSignal) => {
      const notFoundError = toolError(`Doc with id ${docId} not found.`);
      const accessible = await this.ac
        .user(userId)
        .workspace(workspaceId)
        .doc(docId)
        .can('Doc.Read');
      if (!accessible) return notFoundError;
      const aborted = abortIfNeeded(signal);
      if (aborted) return aborted;
      const doc = await this.reader.getDoc(workspaceId, docId);
      if (!doc?.bin) return notFoundError;
      return readCanvas(doc.bin);
    };

    const regionParser = z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .optional();
    const regionInputSchema = {
      type: 'object',
      description:
        'A part of the canvas, in canvas coordinates (x, y of its top-left corner, w, h). Omit for the whole canvas.',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
      },
      required: ['x', 'y', 'w', 'h'],
      additionalProperties: false,
    } as const;

    const readCanvasTool = defineTool({
      name: 'read_canvas',
      title: 'Read Canvas',
      description:
        "List what is on a document's canvas (its edgeless/whiteboard view): handwriting and pen strokes (brush), shapes, text, connectors, and the notes, images and frames placed on it, back to front. Each item has its id, type, position and size in canvas coordinates, and its text. Strokes give a pointCount, not their ink; to see handwriting, use capture_canvas. Pass region to list only what touches that part.",
      parser: z.object({ docId: z.string(), region: regionParser }),
      inputSchema: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          region: regionInputSchema,
        },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId, region }, options) => {
        const canvas = await loadCanvas(docId, options.signal);
        if ('content' in canvas) return canvas;
        const items = region
          ? canvas.items.filter(item => intersects(item, region))
          : canvas.items;
        return toolText(
          JSON.stringify({
            docId,
            hasCanvas: canvas.hasSurface,
            ...(region ? { region } : {}),
            count: items.length,
            items: items.map(describeItem),
          })
        );
      },
    });

    const captureCanvasTool = defineTool({
      name: 'capture_canvas',
      title: 'Capture Canvas',
      description:
        "Take a picture of a document's canvas (its edgeless/whiteboard view), or of one region of it, so you can see handwriting, sketches and layout. Returns a PNG (SVG when the server can't rasterise) plus the region it shows, in canvas coordinates. It is drawn from the stored canvas: strokes, shapes, text and connectors as they are, notes and images as labelled boxes, so it is close to the app's view, not identical. Use read_canvas for ids and exact text.",
      parser: z.object({
        docId: z.string(),
        region: regionParser,
        maxSize: z.number().int().min(100).max(4000).optional(),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          region: regionInputSchema,
          maxSize: {
            type: 'number',
            description:
              'Longest side of the picture in pixels (default 1600). The canvas is never drawn larger than 1:1.',
          },
        },
        required: ['docId'],
        additionalProperties: false,
      },
      execute: async ({ docId, region, maxSize }, options) => {
        const canvas = await loadCanvas(docId, options.signal);
        if ('content' in canvas) return canvas;
        const picture = canvasSvg(canvas.items, region, maxSize);
        const shown = region
          ? canvas.items.filter(item => intersects(item, region)).length
          : canvas.items.length;
        const png = await svgToPng(picture.svg);
        const caption = JSON.stringify({
          docId,
          region: picture.region,
          width: picture.width,
          height: picture.height,
          items: shown,
          format: png ? 'png' : 'svg',
        });
        if (!png) {
          return {
            content: [
              { type: 'text', text: caption },
              { type: 'text', text: picture.svg },
            ],
          };
        }
        return {
          content: [
            { type: 'text', text: caption },
            {
              type: 'image',
              data: png.toString('base64'),
              mimeType: 'image/png',
            },
          ],
        };
      },
    });

    const tools = [
      readDocument,
      hybridSearch,
      docOutline,
      readDocSection,
      readCanvasTool,
      captureCanvasTool,
      semanticSearch,
      keywordSearch,
      searchBlocks,
      listDocuments,
      listBlocks,
      getBoard,
      getBacklinks,
      getLinks,
      notesHealthTool,
    ];

    if (env.dev || env.namespaces.canary || env.mcpWriteToolsEnabled) {
      /**
       * Every MCP write is stamped with a visible attribution line so the
       * document itself — and every version of it in doc history — records
       * that an AI edited it through MCP, and which one. The stamp is
       * appended at the end; consecutive identical stamps are deduped so
       * an agent echoing back the document's content doesn't stack them.
       */
      const stampAttribution = (
        content: string,
        agent: string | undefined
      ): string => {
        const name =
          (agent ?? '').replace(/[\r\n]+/g, ' ').trim() || 'AI agent';
        const now = new Date();
        const stamp = `> Edited via MCP by ${name} — ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
        const trimmed = content.replace(/\s+$/, '');
        const lastLine = trimmed.split('\n').at(-1) ?? '';
        if (lastLine.startsWith(`> Edited via MCP by ${name} — `)) {
          return `${trimmed.slice(0, trimmed.length - lastLine.length)}${stamp}`;
        }
        return `${trimmed}\n\n${stamp}`;
      };

      const agentInputSchema = {
        type: 'string',
        description:
          "Name of the AI model/agent making this edit (e.g. 'claude-sonnet-5'). Used for the 'Edited via MCP' attribution stamp appended to the document.",
      } as const;

      // Notes read as the user's own voice, so an agent's bare "I" is
      // ambiguous to whoever reads them later.
      const firstPersonGuidance =
        ' Writing voice: the notes are the user\'s, so never write a bare "I" — write "I (the agent)" when speaking for yourself and "I (the user)" when recording something in the user\'s own words.';

      const createDocument = defineTool({
        name: 'create_document',
        title: 'Create Document',
        description:
          'Create a new document in the workspace with the given title and markdown content. Returns the ID of the created document. The document is stamped "Edited via MCP by <agent>" so its provenance stays visible in the doc and its history. This tool not support insert or update database block and image yet.' +
          firstPersonGuidance,
        parser: z.object({
          title: z.string().min(1),
          content: z.string(),
          agent: z.string().optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'The title of the new document',
            },
            content: {
              type: 'string',
              description: 'The markdown content for the document body',
            },
            agent: agentInputSchema,
          },
          required: ['title', 'content'],
          additionalProperties: false,
        },
        execute: async ({ title, content, agent }, options) => {
          // A secret written into a synced note stays in its history on
          // every device, so refuse before the write rather than after.
          const secret = guardSecrets(title, content, agent);
          if (secret) return toolError(secret);

          try {
            await this.ac
              .user(userId)
              .workspace(workspaceId)
              .assert('Workspace.CreateDoc');

            const abortedAfterPermission = abortIfNeeded(options.signal);
            if (abortedAfterPermission) return abortedAfterPermission;

            const sanitizedTitle = title.replace(/[\r\n]+/g, ' ').trim();
            if (!sanitizedTitle) throw new Error('Title cannot be empty');
            const strippedContent = content.replace(
              /^[ \t]{0,3}#\s+[^\n]*#*\s*\n*/,
              ''
            );
            const result = await this.writer.createDoc(
              workspaceId,
              sanitizedTitle,
              stampAttribution(strippedContent, agent),
              userId
            );

            return toolText(
              JSON.stringify({
                success: true,
                docId: result.docId,
                message: `Document "${title}" created successfully`,
              })
            );
          } catch (error) {
            return toolError(
              `Failed to create document: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const updateDocument = defineTool({
        name: 'update_document',
        title: 'Update Document',
        description:
          'Update an existing document with new markdown content (body only). Uses structural diffing to apply minimal changes, preserving document history and enabling real-time collaboration. Every update is stamped "Edited via MCP by <agent>". ' +
          "Task workflow: task lists use org-mode annotations at the start of each list item — `[ ]` todo, `[-]` in progress, `[X]` done, or an UPPERCASE keyword — which kanban boards mirroring the list group by, plus planning annotations like `SCHEDULED: <date>`, `DEADLINE: <date>`, `STARTED: [date]`, `CLOSED: [date]` at the end of the line. To pick up a task, rewrite its annotation to `[-]` and append ` @<your-agent-name>` to the task line to claim it; mark it `[X]` when finished. A task that ships code only becomes `[X]` once it is deployed and verified live — until then it climbs `COMMITTED` → `MERGED` → `DEPLOYED`. Keep working memory and documentation in the task's own linked note (see link_document). " +
          'This does NOT update the document title. This tool not support insert or update database block and image yet.' +
          firstPersonGuidance,
        parser: z.object({
          docId: z.string(),
          content: z.string(),
          agent: z.string().optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            docId: {
              type: 'string',
              description: 'The ID of the document to update',
            },
            content: {
              type: 'string',
              description:
                'The complete new markdown content for the document body (do NOT include a title H1)',
            },
            agent: agentInputSchema,
          },
          required: ['docId', 'content'],
          additionalProperties: false,
        },
        execute: async ({ docId, content, agent }, options) => {
          const notFoundError = toolError(`Doc with id ${docId} not found.`);

          const accessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Update');
          if (!accessible) return notFoundError;

          // The whole body comes back on every update, so a secret the user
          // wrote into the note themselves isn't the agent's to answer for.
          if (guardSecrets(content, agent)) {
            const current = await this.reader.getDocMarkdown(
              workspaceId,
              docId,
              false
            );
            const label = findSecret(
              `${content}\n${agent ?? ''}`,
              current?.markdown ?? ''
            );
            if (label) return toolError(secretRefusal(label));
          }

          const abortedBeforeWrite = abortIfNeeded(options.signal);
          if (abortedBeforeWrite) return abortedBeforeWrite;

          try {
            await this.writer.updateDoc(
              workspaceId,
              docId,
              stampAttribution(content, agent),
              userId
            );
            return toolText(
              JSON.stringify({
                success: true,
                docId,
                message: 'Document updated successfully',
              })
            );
          } catch (error) {
            return toolError(
              `Failed to update document: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const updateDocumentMeta = defineTool({
        name: 'update_document_meta',
        title: 'Update Document Metadata',
        description: 'Update document metadata (currently title only).',
        parser: z.object({
          docId: z.string(),
          title: z.string().min(1),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            docId: {
              type: 'string',
              description: 'The ID of the document to update',
            },
            title: {
              type: 'string',
              description: 'The new document title',
            },
          },
          required: ['docId', 'title'],
          additionalProperties: false,
        },
        execute: async ({ docId, title }, options) => {
          const secret = guardSecrets(title);
          if (secret) return toolError(secret);

          const notFoundError = toolError(`Doc with id ${docId} not found.`);

          const accessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Update');
          if (!accessible) return notFoundError;

          const abortedAfterPermission = abortIfNeeded(options.signal);
          if (abortedAfterPermission) return abortedAfterPermission;

          try {
            const sanitizedTitle = title.replace(/[\r\n]+/g, ' ').trim();
            if (!sanitizedTitle) throw new Error('Title cannot be empty');

            await this.writer.updateDocMeta(
              workspaceId,
              docId,
              { title: sanitizedTitle },
              userId
            );

            return toolText(
              JSON.stringify({
                success: true,
                docId,
                message: 'Document title updated successfully',
              })
            );
          } catch (error) {
            return toolError(
              `Failed to update document metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const updateTask = defineTool({
        name: 'update_task',
        title: 'Update Task',
        description:
          'Act on a single task block (from list_blocks / get_board / search_blocks) without rewriting the document: set its org status and/or append a progress note as a child block of the task. ' +
          "Statuses: 'todo' | 'in-progress' | 'done' | a custom keyword. Moving to in-progress stamps STARTED and claims the task with @<agent>; done stamps CLOSED (and checks the native checkbox); back to todo removes CLOSED. " +
          "A task that ships code is not done when the code is written: it climbs the custom keywords 'committed' (on a branch / PR) → 'merged' (landed on the base branch) → 'deployed' (shipped to production) → 'done' (verified live). Never set done on a code change that isn't deployed and verified; a task with nothing to ship goes straight to done. " +
          'Notes are appended under the task, signed "<agent> via MCP". The edit is a surgical CRDT delta — safe alongside concurrent editors and database blocks. ' +
          'Typical board workflow: get_board → list_blocks with the scope → update_task {status: "in-progress"} to pull a card → update_task {note} while working → update_task {status: "committed"}, then "merged" and "deployed" as the change ships → update_task {status: "done"} once it is verified live.' +
          firstPersonGuidance,
        parser: z.object({
          docId: z.string(),
          blockId: z.string(),
          status: z.string().optional(),
          note: z.string().optional(),
          agent: z.string().optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            docId: {
              type: 'string',
              description: 'The document the task block lives in',
            },
            blockId: {
              type: 'string',
              description: 'The task block id (from list_blocks/search_blocks)',
            },
            status: {
              type: 'string',
              description:
                "New org status: 'todo' | 'in-progress' | 'committed' | 'merged' | 'deployed' | 'done' | another custom keyword. Omit to keep.",
            },
            note: {
              type: 'string',
              description:
                'Progress note appended as a child block under the task.',
            },
            agent: agentInputSchema,
          },
          required: ['docId', 'blockId'],
          additionalProperties: false,
        },
        execute: async ({ docId, blockId, status, note, agent }, options) => {
          if (!status && !note) {
            return toolError('Provide a status and/or a note to update.');
          }
          const secret = guardSecrets(note, status, agent);
          if (secret) return toolError(secret);

          const accessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Update');
          if (!accessible) return toolError(`Doc with id ${docId} not found.`);

          const aborted = abortIfNeeded(options.signal);
          if (aborted) return aborted;

          try {
            await this.writer.updateTaskBlock(
              workspaceId,
              docId,
              blockId,
              { status, note, agent },
              userId
            );
            return toolText(
              JSON.stringify({
                success: true,
                docId,
                blockId,
                ...(status ? { status } : {}),
                ...(note ? { noteAdded: true } : {}),
              })
            );
          } catch (error) {
            return toolError(
              `Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const updateBlock = defineTool({
        name: 'update_block',
        title: 'Update Block',
        description:
          'Replace the text of one specific block (paragraph, heading, list item — found via search_blocks / list_blocks / read_document) without rewriting the whole document. The new text is plain (that block\'s inline formatting is dropped; the rest of the doc is untouched); the edit is a surgical CRDT delta, safe alongside concurrent editors, and the document gets the standard "Edited via MCP" attribution stamp. For task status changes or progress notes prefer update_task, which handles org annotations and planning stamps.' +
          firstPersonGuidance,
        parser: z.object({
          docId: z.string(),
          blockId: z.string(),
          text: z.string(),
          agent: z.string().optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            docId: {
              type: 'string',
              description: 'The document the block lives in',
            },
            blockId: {
              type: 'string',
              description:
                'The block id (from search_blocks/list_blocks/read_document)',
            },
            text: {
              type: 'string',
              description:
                "The block's complete new plain text (replaces the current text)",
            },
            agent: agentInputSchema,
          },
          required: ['docId', 'blockId', 'text'],
          additionalProperties: false,
        },
        execute: async ({ docId, blockId, text, agent }, options) => {
          const secret = guardSecrets(text, agent);
          if (secret) return toolError(secret);

          const accessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Update');
          if (!accessible) return toolError(`Doc with id ${docId} not found.`);

          const aborted = abortIfNeeded(options.signal);
          if (aborted) return aborted;

          try {
            await this.writer.updateBlock(
              workspaceId,
              docId,
              blockId,
              text,
              agent,
              userId
            );
            return toolText(JSON.stringify({ success: true, docId, blockId }));
          } catch (error) {
            return toolError(
              `Failed to update block: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const linkDocument = defineTool({
        name: 'link_document',
        title: 'Link Document',
        description:
          "Link a document under another as a real, first-class graph reference (the same relationship the app's own backlinks/graph view are built from) — not a plain-text link. A doc can have several parents; this only adds a link, it never removes or replaces existing ones. Use this to file a newly created or existing document into the graph, e.g. under a topic note.",
        parser: z.object({
          parentDocId: z.string(),
          childDocId: z.string(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            parentDocId: {
              type: 'string',
              description: 'The document the link is added to (the parent).',
            },
            childDocId: {
              type: 'string',
              description: 'The document being linked/filed under the parent.',
            },
          },
          required: ['parentDocId', 'childDocId'],
          additionalProperties: false,
        },
        execute: async ({ parentDocId, childDocId }, options) => {
          const parentAccessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(parentDocId)
            .can('Doc.Update');
          if (!parentAccessible) {
            return toolError(`Doc with id ${parentDocId} not found.`);
          }
          const childAccessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(childDocId)
            .can('Doc.Read');
          if (!childAccessible) {
            return toolError(`Doc with id ${childDocId} not found.`);
          }

          const abortedAfterPermission = abortIfNeeded(options.signal);
          if (abortedAfterPermission) return abortedAfterPermission;

          try {
            await this.writer.linkDoc(
              workspaceId,
              parentDocId,
              childDocId,
              userId
            );
            return toolText(
              JSON.stringify({
                success: true,
                parentDocId,
                childDocId,
                message: 'Document linked successfully',
              })
            );
          } catch (error) {
            return toolError(
              `Failed to link document: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const createDiagram = defineTool({
        name: 'create_diagram',
        title: 'Create Diagram',
        description:
          'Add a Mermaid diagram (flowchart, sequence, class, state, ER, gantt, pie, mindmap, timeline, journey) to the notes; it shows as the drawing, not its source. With docId it is appended to the end of that document, leaving the rest as it is; without, a new document is created (title required) and its ID returned. Pass only the Mermaid source, without the ``` fence.',
        parser: z.object({
          docId: z.string().optional(),
          title: z.string().optional(),
          mermaid: z.string(),
          caption: z.string().optional(),
          agent: z.string().optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            docId: {
              type: 'string',
              description:
                'The document to append the diagram to. Omit to create a new document.',
            },
            title: {
              type: 'string',
              description: 'Title of the new document, when no docId is given.',
            },
            mermaid: {
              type: 'string',
              description:
                "The Mermaid source, starting with its diagram type, e.g. 'flowchart TD\\n  A --> B'.",
            },
            caption: {
              type: 'string',
              description: 'A line of text placed above the diagram.',
            },
            agent: agentInputSchema,
          },
          required: ['mermaid'],
          additionalProperties: false,
        },
        execute: async ({ docId, title, mermaid, caption, agent }, options) => {
          const source = mermaidSource(mermaid);
          if (typeof source !== 'string') return toolError(source.error);
          const block = [
            ...(caption?.trim()
              ? [caption.replace(/[\r\n]+/g, ' ').trim(), '']
              : []),
            '```mermaid',
            source,
            '```',
          ].join('\n');

          if (!docId) {
            const sanitizedTitle = (title ?? '')
              .replace(/[\r\n]+/g, ' ')
              .trim();
            if (!sanitizedTitle) {
              return toolError(
                'Give a title for the new document, or a docId to add the diagram to.'
              );
            }
            try {
              await this.ac
                .user(userId)
                .workspace(workspaceId)
                .assert('Workspace.CreateDoc');
              const aborted = abortIfNeeded(options.signal);
              if (aborted) return aborted;
              const result = await this.writer.createDoc(
                workspaceId,
                sanitizedTitle,
                stampAttribution(block, agent),
                userId
              );
              return toolText(
                JSON.stringify({
                  success: true,
                  docId: result.docId,
                  message: `Diagram created in new document "${sanitizedTitle}"`,
                })
              );
            } catch (error) {
              return toolError(
                `Failed to create diagram: ${error instanceof Error ? error.message : 'Unknown error'}`
              );
            }
          }

          const notFoundError = toolError(`Doc with id ${docId} not found.`);
          const accessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Update');
          if (!accessible) return notFoundError;

          const aborted = abortIfNeeded(options.signal);
          if (aborted) return aborted;

          try {
            // The doc as it is now, plus the diagram: the writer's structural
            // diff leaves every existing block untouched and adds the new one.
            const current = await this.reader.getDocMarkdown(
              workspaceId,
              docId,
              false
            );
            if (!current) return notFoundError;
            // This agent's last stamp moves below the diagram rather than
            // staying above it; another agent's stays, as update_document does.
            const name =
              (agent ?? '').replace(/[\r\n]+/g, ' ').trim() || 'AI agent';
            const trimmed = current.markdown.replace(/\s+$/, '');
            const lastLine = trimmed.split('\n').at(-1) ?? '';
            const body = lastLine.startsWith(`> Edited via MCP by ${name} — `)
              ? trimmed.slice(0, trimmed.length - lastLine.length).trimEnd()
              : trimmed;
            await this.writer.updateDoc(
              workspaceId,
              docId,
              stampAttribution(body ? `${body}\n\n${block}` : block, agent),
              userId
            );
            return toolText(
              JSON.stringify({
                success: true,
                docId,
                message: 'Diagram added to the end of the document',
              })
            );
          } catch (error) {
            return toolError(
              `Failed to add diagram: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      const xy = z.tuple([z.number(), z.number()]);
      const drawItemParser = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('stroke'),
          key: z.string().optional(),
          points: z
            .array(z.union([xy, z.tuple([z.number(), z.number(), z.number()])]))
            .min(2)
            .max(5000),
          color: z.string().optional(),
          width: z.number().positive().max(100).optional(),
        }),
        z.object({
          type: z.literal('shape'),
          key: z.string().optional(),
          shape: z.enum(['rect', 'ellipse', 'diamond', 'triangle']).optional(),
          x: z.number(),
          y: z.number(),
          w: z.number().positive(),
          h: z.number().positive(),
          text: z.string().optional(),
          color: z.string().optional(),
          fill: z.string().optional(),
        }),
        z.object({
          type: z.literal('text'),
          key: z.string().optional(),
          x: z.number(),
          y: z.number(),
          text: z.string().min(1),
          fontSize: z.number().positive().max(400).optional(),
          color: z.string().optional(),
        }),
        z.object({
          type: z.literal('connector'),
          key: z.string().optional(),
          from: z.union([z.string(), xy]),
          to: z.union([z.string(), xy]),
          color: z.string().optional(),
        }),
      ]);

      const drawOnCanvasTool = defineTool({
        name: 'draw_on_canvas',
        title: 'Draw On Canvas',
        description:
          "Draw on a document's canvas (its edgeless/whiteboard view), on top of what is there; nothing existing is moved or removed. Items: `stroke` (freehand pen ink through points, e.g. to circle, underline or annotate something), `shape` (rect, ellipse, diamond or triangle, with optional text inside), `text`, and `connector` (an arrow; each end is an [x, y] point, an element id from read_canvas, or the `key` of an item drawn earlier in the same call). Coordinates are canvas coordinates, as read_canvas and capture_canvas report them. Colours are CSS colours such as '#d14' (default near-black). Returns the new element ids. Check the result with capture_canvas.",
        parser: z.object({
          docId: z.string(),
          items: z.array(drawItemParser).min(1).max(200),
          agent: z.string().optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            docId: { type: 'string' },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['stroke', 'shape', 'text', 'connector'],
                  },
                  key: {
                    type: 'string',
                    description:
                      'A name for this item, so a connector later in the call can point at it.',
                  },
                  points: {
                    type: 'array',
                    description:
                      'stroke: [x, y] points (or [x, y, pressure]) along the pen path, at least 2.',
                    items: { type: 'array', items: { type: 'number' } },
                  },
                  width: {
                    type: 'number',
                    description: 'stroke: line width (default 4).',
                  },
                  shape: {
                    type: 'string',
                    enum: ['rect', 'ellipse', 'diamond', 'triangle'],
                  },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' },
                  text: { type: 'string' },
                  fontSize: {
                    type: 'number',
                    description: 'text: font size (default 24).',
                  },
                  from: {
                    description: 'connector start: [x, y], element id or key.',
                  },
                  to: {
                    description: 'connector end: [x, y], element id or key.',
                  },
                  color: { type: 'string' },
                  fill: {
                    type: 'string',
                    description: 'shape: fill colour (default unfilled).',
                  },
                },
                required: ['type'],
              },
            },
            agent: agentInputSchema,
          },
          required: ['docId', 'items'],
          additionalProperties: false,
        },
        execute: async ({ docId, items }, options) => {
          const secret = guardSecrets(
            ...items.map(item => ('text' in item ? item.text : undefined))
          );
          if (secret) return toolError(secret);
          const accessible = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Update');
          if (!accessible) return toolError(`Doc with id ${docId} not found.`);

          const aborted = abortIfNeeded(options.signal);
          if (aborted) return aborted;

          try {
            const { ids } = await this.writer.editDoc(
              workspaceId,
              docId,
              binary => drawOnCanvas(binary, items as DrawItem[]),
              userId
            );
            return toolText(JSON.stringify({ success: true, docId, ids }));
          } catch (error) {
            if (error instanceof CanvasError) return toolError(error.message);
            return toolError(
              `Failed to draw on canvas: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        },
      });

      tools.push(
        createDocument,
        updateDocument,
        updateDocumentMeta,
        linkDocument,
        updateTask,
        updateBlock,
        createDiagram,
        drawOnCanvasTool
      );
    }

    return {
      name: `NotesGraph MCP Server for Workspace ${workspaceId}`,
      version: '1.0.1',
      tools,
    };
  }

  /**
   * Every row a search matches, page by page, up to a cap so one huge
   * workspace can't hold a tool call for minutes.
   */
  private async searchAll(
    input: Omit<SearchInput, 'options'> & { options: { fields: string[] } },
    max = 20_000
  ) {
    const nodes: Awaited<ReturnType<IndexerService['search']>>['nodes'] = [];
    let cursor: string | undefined;
    do {
      const result = await this.indexer.search({
        ...input,
        options: { ...input.options, pagination: { limit: 5000, cursor } },
      });
      nodes.push(...result.nodes);
      // Manticore can hand back the same cursor at the end (see listDocIds).
      if (!result.nodes.length || result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    } while (cursor && nodes.length < max);
    return nodes;
  }

  /** Best-effort title lookup for a batch of docIds (used to annotate link results). */
  private async titlesFor(workspaceId: string, docIds: string[]) {
    if (docIds.length === 0) return [];
    const result = await this.indexer.search({
      table: SearchTable.doc,
      query: {
        type: SearchQueryType.boolean,
        occur: SearchQueryOccur.must,
        queries: [
          {
            type: SearchQueryType.match,
            field: 'workspaceId',
            match: workspaceId,
          },
          {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.should,
            queries: docIds.map(docId => ({
              type: SearchQueryType.match,
              field: 'docId',
              match: docId,
            })),
          },
        ],
      },
      options: {
        fields: ['docId', 'title'],
        pagination: { limit: docIds.length },
      },
    });
    const titleByDocId = new Map(
      result.nodes.map(node => [
        first(node.fields.docId),
        first(node.fields.title),
      ])
    );
    return docIds.map(docId => ({
      docId,
      title: titleByDocId.get(docId) || 'Untitled',
    }));
  }
}
