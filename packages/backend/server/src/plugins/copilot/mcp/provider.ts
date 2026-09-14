import { Injectable } from '@nestjs/common';
import { pick } from 'lodash-es';
import z from 'zod/v3';

import { DocReader, DocWriter } from '../../../core/doc';
import { PermissionAccess } from '../../../core/permission';
import { clearEmbeddingChunk } from '../../../models';
import { IndexerService } from '../../indexer';
import { SearchTable } from '../../indexer/tables';
import { SearchQueryOccur, SearchQueryType } from '../../indexer/types';
import { CopilotContextService } from '../context/service';

function first(value: unknown): string {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === 'string' ? item : '';
}

/**
 * Multi-value index fields come back as a plain string, an array, or (from
 * the Manticore write path) a JSON-stringified array — normalize to a
 * string list.
 */
function tokenList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value) return [];
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === 'string'
        );
      }
    } catch {
      // fall through — treat as a single token
    }
  }
  return [value];
}

type McpTextContent = {
  type: 'text';
  text: string;
};

export type WorkspaceMcpToolResult = {
  content: McpTextContent[];
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
    private readonly indexer: IndexerService
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
      description:
        'Retrieve conceptually related passages by performing vector-based semantic similarity search across embedded documents; use this tool only when exact keyword search fails or the user explicitly needs meaning-level matches (e.g., paraphrases, synonyms, broader concepts, recent documents). Pass docId to scope matching to a single document.',
      parser: z.object({ query: z.string(), docId: z.string().optional() }),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
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
        const trimmed = query.trim();
        if (!trimmed) {
          return toolError('Query is required for semantic search.');
        }

        const chunks = await this.context.matchWorkspaceDocs(
          workspaceId,
          trimmed,
          5,
          options.signal,
          undefined,
          undefined,
          docId ? [docId] : undefined
        );

        const abortedAfterMatch = abortIfNeeded(options.signal);
        if (abortedAfterMatch) return abortedAfterMatch;

        const docs = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .docs(
            chunks.filter(chunk => 'docId' in chunk),
            'Doc.Read'
          );

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
      description:
        'Fuzzy search all workspace documents for the exact keyword or phrase supplied and return matching documents ranked by textual match. Use this tool by default whenever a straightforward term-based or keyword-base lookup is sufficient. For block-level hits, or to search inside one document, use search_blocks instead.',
      parser: z.object({ query: z.string() }),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async ({ query }, options) => {
        const trimmed = query.trim();
        if (!trimmed) return toolError('Query is required for keyword search.');

        let docs = await this.indexer.searchDocsByKeyword(workspaceId, trimmed);

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
          .filter(
            block => block.text && (!docId || block.docId === docId)
          );

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
        'Query individual task blocks (todo list items) across the whole workspace by their inline #tags, #key:value properties and org status — the block-level equivalent of list_documents. Returns each task\'s docId/blockId, text, status (todo | in-progress | done | custom keyword), tags, properties and org planning timestamps. To act on a task, read_document its docId and update_document the task line (see update_document for the org-mode workflow).',
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
      execute: async ({ tags, props, status, docId, limit, cursor }, options) => {
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
        'Read the virtual kanban/table boards defined in a document: each board is a saved query (scope) over task blocks — inline #tags, #key:value props, org status slice, and an optional due-within-days bound. Combine the scope with list_blocks to fetch the board\'s tasks, then act on a task with update_task (pull into in-progress, add notes, mark done). Find board documents with keyword_search or list_documents first.',
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
                  ? 'Fetch tasks with list_blocks using each board\'s tags/props (and status to slice by column); update a task with update_task.'
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
        "List documents that link to the given document (its \"parents\" in the graph — NotesGraph has no single fixed parent, a doc can have several). Use this to understand where a document sits in the graph before you decide where to file something new.",
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
        const titled = await this.titlesFor(workspaceId, readable.map(d => d.docId));

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
        const titled = await this.titlesFor(workspaceId, readable.map(d => d.docId));

        const abortedAfterFilter = abortIfNeeded(options.signal);
        if (abortedAfterFilter) return abortedAfterFilter;

        return toolText(JSON.stringify({ links: titled }));
      },
    });

    const tools = [
      readDocument,
      semanticSearch,
      keywordSearch,
      searchBlocks,
      listDocuments,
      listBlocks,
      getBoard,
      getBacklinks,
      getLinks,
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

      const createDocument = defineTool({
        name: 'create_document',
        title: 'Create Document',
        description:
          'Create a new document in the workspace with the given title and markdown content. Returns the ID of the created document. The document is stamped "Edited via MCP by <agent>" so its provenance stays visible in the doc and its history. This tool not support insert or update database block and image yet.',
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
          'Task workflow: task lists use org-mode annotations at the start of each list item — `[ ]` todo, `[-]` in progress, `[X]` done, or an UPPERCASE keyword — which kanban boards mirroring the list group by, plus planning annotations like `SCHEDULED: <date>`, `DEADLINE: <date>`, `STARTED: [date]`, `CLOSED: [date]` at the end of the line. To pick up a task, rewrite its annotation to `[-]` and append ` @<your-agent-name>` to the task line to claim it; mark it `[X]` when finished. Keep working memory and documentation in the task\'s own linked note (see link_document). ' +
          'This does NOT update the document title. This tool not support insert or update database block and image yet.',
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
          'Notes are appended under the task, signed "<agent> via MCP". The edit is a surgical CRDT delta — safe alongside concurrent editors and database blocks. ' +
          'Typical board workflow: get_board → list_blocks with the scope → update_task {status: "in-progress"} to pull a card → update_task {note} while working → update_task {status: "done"}.',
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
                "New org status: 'todo' | 'in-progress' | 'done' | custom keyword. Omit to keep.",
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
          'Replace the text of one specific block (paragraph, heading, list item — found via search_blocks / list_blocks / read_document) without rewriting the whole document. The new text is plain (that block\'s inline formatting is dropped; the rest of the doc is untouched); the edit is a surgical CRDT delta, safe alongside concurrent editors, and the document gets the standard "Edited via MCP" attribution stamp. For task status changes or progress notes prefer update_task, which handles org annotations and planning stamps.',
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
          'Link a document under another as a real, first-class graph reference (the same relationship the app\'s own backlinks/graph view are built from) — not a plain-text link. A doc can have several parents; this only adds a link, it never removes or replaces existing ones. Use this to file a newly created or existing document into the graph, e.g. under a topic note.',
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

      tools.push(
        createDocument,
        updateDocument,
        updateDocumentMeta,
        linkDocument,
        updateTask,
        updateBlock
      );
    }

    return {
      name: `NotesGraph MCP Server for Workspace ${workspaceId}`,
      version: '1.0.1',
      tools,
    };
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
      result.nodes.map(node => [first(node.fields.docId), first(node.fields.title)])
    );
    return docIds.map(docId => ({
      docId,
      title: titleByDocId.get(docId) || 'Untitled',
    }));
  }
}
