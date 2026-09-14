import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { connectNotes } from './connect';
import { backlinks, links } from './graph';
import {
  appendNote,
  createNote,
  editNote,
  listNotes,
  searchNotes,
  viewNote,
} from './notes';
import type { Transport } from './transport';
import {
  capture,
  findOrphans,
  suggestLinks,
  summarizeBacklinks,
} from './wiki';

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

// AI memory store: "specially-marked" notes the AI writes to and recalls. A
// memory note is marked by its title — exactly `Memory` (the default log) or
// `Memory: <topic>` — and carries an #ai-memory tag line for discoverability.
const MEMORY_PREFIX = 'Memory';
const MEMORY_TAG = '#ai-memory';
const memoryTitle = (topic?: string) =>
  topic && topic.trim() ? `${MEMORY_PREFIX}: ${topic.trim()}` : MEMORY_PREFIX;
const isMemoryTitle = (title: string) =>
  title === MEMORY_PREFIX || title.startsWith(`${MEMORY_PREFIX}:`);

/**
 * Exposes the notes tooling to an AI over MCP (stdio) — parity with the CLI:
 * list / search / view, plus create (write a note as memory) when connected to
 * a live backend. Nothing here writes to stdout except the MCP protocol.
 */
export async function runMcp(transport: Transport): Promise<void> {
  const server = new McpServer({ name: 'ngraph', version: '0.26.3' });

  server.tool(
    'list_notes',
    'List every note as `id<TAB>title`.',
    {},
    async () => {
      const notes = await listNotes(transport);
      return text(
        notes
          .map(n => `${n.id}\t${n.title || '(untitled)'}`)
          .join('\n') || '(no notes)'
      );
    }
  );

  server.tool(
    'search_notes',
    'Search notes by title; set content=true to also grep note bodies.',
    { query: z.string(), content: z.boolean().optional() },
    async ({ query, content }) => {
      const hits = await searchNotes(transport, query, { content });
      return text(
        hits
          .map(
            h =>
              `${h.id}\t${h.title || '(untitled)'}${
                h.snippet ? '  — ' + h.snippet : ''
              }`
          )
          .join('\n') || '(no matches)'
      );
    }
  );

  server.tool(
    'view_note',
    'Get a note rendered as markdown by id.',
    { id: z.string() },
    async ({ id }) => {
      const view = await viewNote(transport, id);
      return view
        ? text(`# ${view.title}\n\n${view.markdown}`)
        : { ...text(`Note not found: ${id}`), isError: true };
    }
  );

  server.tool(
    'list_links',
    'List the notes a given note references (outgoing graph edges).',
    { id: z.string() },
    async ({ id }) => {
      const out = await links(transport, id);
      return text(
        out
          .map(l => `${l.pageId}\t${l.title || '(untitled)'}`)
          .join('\n') || '(no outgoing links)'
      );
    }
  );

  server.tool(
    'list_backlinks',
    'List the notes that reference a given note (incoming graph edges).',
    { id: z.string() },
    async ({ id }) => {
      const back = await backlinks(transport, id);
      return text(
        back
          .map(b => `${b.id}\t${b.title || '(untitled)'}`)
          .join('\n') || '(no backlinks)'
      );
    }
  );

  server.tool(
    'connect_notes',
    'Link one note to another (create a graph edge) by inserting an inline reference.',
    { from: z.string(), to: z.string(), label: z.string().optional() },
    async ({ from, to, label }) => {
      await connectNotes(transport, from, to, label ?? 'Related:');
      return text(`Linked ${from} → ${to}`);
    }
  );

  server.tool(
    'suggest_links',
    'Suggest notes to link to a given note, ranked by shared vocabulary and title mentions. Excludes existing links.',
    { id: z.string(), limit: z.number().optional() },
    async ({ id, limit }) => {
      const suggestions = await suggestLinks(transport, id, { limit });
      return text(
        suggestions
          .map(s => `${s.id}\t${s.title || '(untitled)'}\t${s.reason} (${s.score})`)
          .join('\n') || '(no suggestions)'
      );
    }
  );

  server.tool(
    'summarize_backlinks',
    'List notes that reference a given note, each with the text of the referencing block(s).',
    { id: z.string() },
    async ({ id }) => {
      const digests = await summarizeBacklinks(transport, id);
      return text(
        digests
          .map(
            d =>
              `${d.id}\t${d.title || '(untitled)'}\n${d.contexts
                .map(c => `  ${c}`)
                .join('\n')}`
          )
          .join('\n') || '(no backlinks)'
      );
    }
  );

  server.tool(
    'find_orphans',
    'List notes with no incoming or outgoing links (disconnected from the graph).',
    {},
    async () => {
      const orphans = await findOrphans(transport);
      return text(
        orphans
          .map(o => `${o.id}\t${o.title || '(untitled)'}`)
          .join('\n') || '(no orphans)'
      );
    }
  );

  server.tool(
    'list_memories',
    'List the AI memory notes — notes marked as memory (titled "Memory" or "Memory: <topic>").',
    {},
    async () => {
      const notes = await listNotes(transport);
      const mem = notes.filter(n => isMemoryTitle(n.title || ''));
      return text(
        mem.map(n => `${n.id}\t${n.title}`).join('\n') || '(no memories yet)'
      );
    }
  );

  server.tool(
    'recall',
    'Read the AI memory store (the notes marked as memory). Optionally pass `query` to return only memories whose text matches.',
    { query: z.string().optional() },
    async ({ query }) => {
      const notes = await listNotes(transport);
      const mem = notes.filter(n => isMemoryTitle(n.title || ''));
      const q = query?.toLowerCase();
      const out: string[] = [];
      for (const n of mem) {
        const view = await viewNote(transport, n.id);
        if (!view) continue;
        if (q && !`${view.title}\n${view.markdown}`.toLowerCase().includes(q)) {
          continue;
        }
        out.push(`# ${view.title} (${view.id})\n${view.markdown.trim()}`);
      }
      return text(out.join('\n\n---\n\n') || '(no matching memories)');
    }
  );

  if (transport.createNote) {
    server.tool(
      'create_note',
      'Create a note from markdown (e.g. an AI memory). Returns the new note id.',
      { title: z.string(), markdown: z.string() },
      async ({ title, markdown }) => {
        const id = await createNote(transport, title, markdown);
        return text(id);
      }
    );

    server.tool(
      'capture',
      'Append a timestamped line to today’s journal note (or a named note), creating it if needed.',
      { text: z.string(), title: z.string().optional() },
      async ({ text: body, title }) => {
        const res = await capture(transport, body, { title });
        return text(
          `${res.created ? 'Created' : 'Appended to'} “${res.title}” (${res.id})`
        );
      }
    );
  }

  if (transport.editNote) {
    server.tool(
      'edit_note',
      'Replace a note body with new markdown (title is preserved).',
      { id: z.string(), markdown: z.string() },
      async ({ id, markdown }) => {
        await editNote(transport, id, markdown);
        return text(`Updated ${id}`);
      }
    );

    server.tool(
      'append_note',
      'Append markdown to a note body (e.g. add to an AI memory log).',
      { id: z.string(), markdown: z.string() },
      async ({ id, markdown }) => {
        await appendNote(transport, id, markdown);
        return text(`Appended to ${id}`);
      }
    );
  }

  if (transport.createNote && transport.editNote) {
    server.tool(
      'remember',
      'Save something to the AI memory store: appends a timestamped entry to a memory note ("Memory: <topic>", or just "Memory"), creating it if needed. Read it back with recall / list_memories.',
      { text: z.string(), topic: z.string().optional() },
      async ({ text: body, topic }) => {
        const title = memoryTitle(topic);
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const entry = `- ${stamp} — ${body.trim()}`;
        const notes = await listNotes(transport);
        const existing = notes.find(n => (n.title || '') === title);
        if (existing) {
          await appendNote(transport, existing.id, entry);
          return text(`Remembered in “${title}” (${existing.id})`);
        }
        const id = await createNote(
          transport,
          title,
          `${MEMORY_TAG}\n\n${entry}`
        );
        return text(`Created memory “${title}” (${id})`);
      }
    );
  }

  await server.connect(new StdioServerTransport());
}
