import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { clearConfig, loadConfig, saveConfig } from './config';
import { connectNotes } from './connect';
import { discoverDbs } from './discover';
import { backlinks, links } from './graph';
import {
  appendNote,
  createNote,
  editNote,
  listNotes,
  searchNotes,
  viewNote,
} from './notes';
import { RemoteTransport } from './remote';
import { LocalTransport, type Transport } from './transport';
import {
  capture,
  findOrphans,
  suggestLinks,
  summarizeBacklinks,
} from './wiki';

interface Args {
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function pickDb(flags: Args['flags']): string {
  if (typeof flags.db === 'string') return flags.db;
  const found = discoverDbs();
  if (found.length === 0) {
    throw new Error(
      'No workspace database found. Pass --db <path-to-storage.db>.'
    );
  }
  if (found.length > 1) {
    console.error('Multiple workspaces found; using the first (--db to pick):');
    found.forEach(f => console.error('  ' + f));
  }
  return found[0];
}

function makeTransport(flags: Args['flags']): Transport {
  // Explicit --db forces offline.
  if (typeof flags.db === 'string') {
    return new LocalTransport(flags.db);
  }
  // Explicit --server/--token (or env) forces live.
  const server =
    typeof flags.server === 'string'
      ? flags.server
      : process.env.NOTESGRAPH_SERVER_URL;
  const token =
    typeof flags.token === 'string'
      ? flags.token
      : process.env.NOTESGRAPH_TOKEN;
  if (server && token) {
    const workspace =
      typeof flags.workspace === 'string'
        ? flags.workspace
        : process.env.NOTESGRAPH_WORKSPACE;
    if (!workspace) {
      throw new Error('--workspace <id> is required with --server/--token');
    }
    return new RemoteTransport(server, token, workspace);
  }
  // A saved `login` session is the default when present.
  const config = loadConfig();
  if (config) {
    return new RemoteTransport(config.server, config.token, config.workspace);
  }
  // Otherwise fall back to a discovered offline database.
  return new LocalTransport(pickDb(flags));
}

/** Read markdown body from stdin when it's piped (for `create`). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Open text in $EDITOR (fallback vi/nano) and return the saved result. */
async function editInEditor(initial: string): Promise<string> {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'ngraph-'));
  const file = join(dir, 'note.md');
  writeFileSync(file, initial, 'utf8');
  const [bin, ...preArgs] = editor.split(/\s+/);
  const result = spawnSync(bin, [...preArgs, file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Editor exited with status ${result.status}`);
  }
  return readFileSync(file, 'utf8');
}

interface SessionResponse {
  user: { id: string; email?: string; name?: string };
  workspaceIds: string[];
}

async function login(flags: Args['flags']) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const server = (
      (typeof flags.server === 'string' && flags.server) ||
      (await rl.question('Server URL (e.g. https://notes.example.com): '))
    )
      .trim()
      .replace(/\/+$/, '');
    const token = (
      (typeof flags.token === 'string' && flags.token) ||
      (await rl.question('Personal access token: '))
    ).trim();
    if (!server || !token) {
      throw new Error('Server URL and token are required');
    }

    const res = await fetch(`${server}/api/notes/session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Login failed — server ${res.status}: ${await res.text()}`);
    }
    const { user, workspaceIds } = (await res.json()) as SessionResponse;

    let workspace =
      typeof flags.workspace === 'string' ? flags.workspace : '';
    if (!workspace) {
      if (workspaceIds.length === 0) {
        throw new Error('This account has no workspaces.');
      } else if (workspaceIds.length === 1) {
        workspace = workspaceIds[0];
      } else {
        console.log('Workspaces:');
        workspaceIds.forEach((w, i) => console.log(`  ${i + 1}) ${w}`));
        const pick = (await rl.question('Pick a workspace [1]: ')).trim();
        workspace = workspaceIds[Number(pick || '1') - 1] ?? workspaceIds[0];
      }
    }

    const path = saveConfig({ server, token, workspace });
    console.log(
      `Logged in as ${user.email ?? user.id}. Workspace: ${workspace}`
    );
    console.log(`Saved to ${path}`);
  } finally {
    rl.close();
  }
}

const USAGE =
  'Usage: ngraph <command>\n' +
  '  login [--server <url>] [--token <pat>] [--workspace <id>]  connect to a backend\n' +
  '  logout                                                     forget the saved login\n' +
  '  whoami                                                     show the active connection\n' +
  '  list                                                       list notes\n' +
  '  search <query> [--content]                                 search notes\n' +
  '  view <id>                                                  print a note as markdown\n' +
  '  create <title> [--body <md> | stdin]                       create a note (live backend)\n' +
  '  edit <id> [--body <md> | stdin]                            replace a note body ($EDITOR if no body)\n' +
  '  append <id> [--body <md> | stdin]                          append to a note body (live backend)\n' +
  '  connect <from-id> <to-id> [--label <text>]                 link one note to another (graph edge)\n' +
  '  links <id>                                                 list notes this note references\n' +
  '  backlinks <id> [--context]                                 list notes that reference this note\n' +
  '  capture <text | stdin> [--title <t>]                       append a timestamped line to today’s journal\n' +
  '  suggest <id> [--limit <n>]                                 suggest notes to link to this one\n' +
  '  orphans                                                    list notes with no links\n' +
  '  mcp                                                        run as an MCP server (stdio)\n' +
  '  tui                                                        interactive browser (default)\n' +
  '  (offline override: --db <storage.db>)';

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;

  if (cmd === 'login') {
    await login(flags);
    return;
  }
  if (cmd === 'logout') {
    console.log(clearConfig() ? 'Logged out.' : 'Not logged in.');
    return;
  }
  if (cmd === 'whoami') {
    const config = loadConfig();
    console.log(
      config
        ? `${config.server} · workspace ${config.workspace}`
        : 'Not logged in (using the offline database).'
    );
    return;
  }

  if (cmd === 'mcp') {
    const { runMcp } = await import('./mcp');
    await runMcp(makeTransport(flags));
    return;
  }

  if (!cmd || cmd === 'tui') {
    const { runTui } = await import('./tui');
    await runTui(makeTransport(flags));
    return;
  }

  const transport = makeTransport(flags);
  try {
    if (cmd === 'list') {
      for (const note of await listNotes(transport)) {
        console.log(`${note.id}  ${note.title || '(untitled)'}`);
      }
    } else if (cmd === 'search') {
      const hits = await searchNotes(transport, rest.join(' '), {
        content: !!flags.content,
      });
      for (const hit of hits) {
        console.log(
          `${hit.id}  ${hit.title || '(untitled)'}${
            hit.snippet ? '  — ' + hit.snippet : ''
          }`
        );
      }
    } else if (cmd === 'view') {
      const view = await viewNote(transport, rest[0]);
      if (!view) {
        console.error('Note not found: ' + rest[0]);
        process.exit(1);
      }
      console.log(`# ${view.title}\n`);
      console.log(view.markdown);
    } else if (cmd === 'create') {
      const title = rest.join(' ') || 'Untitled';
      const markdown =
        typeof flags.body === 'string' ? flags.body : await readStdin();
      const docId = await createNote(transport, title, markdown);
      console.log(docId);
    } else if (cmd === 'edit') {
      const id = rest[0];
      if (!id) throw new Error('Usage: ngraph edit <id> [--body <md> | stdin]');
      let markdown: string;
      if (typeof flags.body === 'string') {
        markdown = flags.body;
      } else if (!process.stdin.isTTY) {
        markdown = await readStdin();
      } else {
        // Interactive: round-trip the current body through $EDITOR.
        const current = await viewNote(transport, id);
        if (!current) throw new Error('Note not found: ' + id);
        markdown = await editInEditor(current.markdown);
      }
      await editNote(transport, id, markdown);
      console.log(`Updated ${id}`);
    } else if (cmd === 'append') {
      const id = rest[0];
      if (!id) throw new Error('Usage: ngraph append <id> [--body <md> | stdin]');
      const markdown =
        typeof flags.body === 'string' ? flags.body : await readStdin();
      if (!markdown.trim()) throw new Error('Nothing to append (pass --body or pipe stdin)');
      await appendNote(transport, id, markdown);
      console.log(`Appended to ${id}`);
    } else if (cmd === 'connect') {
      const [fromId, toId] = rest;
      if (!fromId || !toId) {
        throw new Error('Usage: ngraph connect <from-id> <to-id> [--label <text>]');
      }
      const label = typeof flags.label === 'string' ? flags.label : 'Related:';
      await connectNotes(transport, fromId, toId, label);
      console.log(`Linked ${fromId} → ${toId}`);
    } else if (cmd === 'links') {
      if (!rest[0]) throw new Error('Usage: ngraph links <id>');
      const out = await links(transport, rest[0]);
      if (out.length === 0) console.log('(no outgoing links)');
      for (const l of out) {
        console.log(`${l.pageId}  ${l.title || '(untitled)'}`);
      }
    } else if (cmd === 'backlinks') {
      if (!rest[0]) throw new Error('Usage: ngraph backlinks <id> [--context]');
      if (flags.context) {
        const digests = await summarizeBacklinks(transport, rest[0]);
        if (digests.length === 0) console.log('(no backlinks)');
        for (const d of digests) {
          console.log(`${d.id}  ${d.title || '(untitled)'}`);
          for (const ctx of d.contexts) console.log(`    ${ctx}`);
        }
      } else {
        const back = await backlinks(transport, rest[0]);
        if (back.length === 0) console.log('(no backlinks)');
        for (const b of back) {
          console.log(`${b.id}  ${b.title || '(untitled)'}`);
        }
      }
    } else if (cmd === 'capture') {
      const text =
        rest.join(' ').trim() ||
        (typeof flags.body === 'string' ? flags.body : await readStdin());
      const title = typeof flags.title === 'string' ? flags.title : undefined;
      const res = await capture(transport, text, { title });
      console.log(
        `${res.created ? 'Created' : 'Appended to'} “${res.title}” (${res.id})`
      );
    } else if (cmd === 'suggest') {
      if (!rest[0]) throw new Error('Usage: ngraph suggest <id> [--limit <n>]');
      const limit =
        typeof flags.limit === 'string' ? Number(flags.limit) : undefined;
      const suggestions = await suggestLinks(transport, rest[0], { limit });
      if (suggestions.length === 0) console.log('(no suggestions)');
      for (const s of suggestions) {
        console.log(
          `${s.id}  ${s.title || '(untitled)'}  — ${s.reason} (${s.score})`
        );
      }
    } else if (cmd === 'orphans') {
      const orphans = await findOrphans(transport);
      if (orphans.length === 0) console.log('(no orphans)');
      for (const o of orphans) {
        console.log(`${o.id}  ${o.title || '(untitled)'}`);
      }
    } else {
      console.error('Unknown command: ' + cmd + '\n' + USAGE);
      process.exit(1);
    }
  } finally {
    transport.close?.();
  }
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
