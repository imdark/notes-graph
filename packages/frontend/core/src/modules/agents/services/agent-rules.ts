import { Text } from '@blocksuite/notesgraph/store';
import { Service } from '@notesgraph/infra';

import type { DocRecord, DocsService } from '../../doc';
import { storeMarkdown } from './context';

/**
 * The user's own rules for agents, kept as a note in the workspace like an
 * AGENTS.md: where research goes, how notes are named, which tags to use.
 * The built-in conventions live in the device agent's system prompt (the
 * server's agent-profiles.ts); this note is how the user changes them
 * without a deploy. Every run reads it when it starts.
 *
 * A device run gets it from the server, which adds it to the profile a
 * runner claims (registry/agent-rules.ts, same title, same wording); an
 * in-tab run gets it here.
 */
export const AGENT_RULES_TITLE = 'Agent rules';

/**
 * Longest rules text handed to a run, in characters. It goes into every
 * run's system prompt, and a small on-device model has little room; the
 * tail is cut and the agent told so.
 */
export const MAX_AGENT_RULES_CHARS = 8_000;

/** How long a run waits for the note to load before going without it. */
const LOAD_WAIT_MS = 3_000;

/**
 * The rules as a system-prompt section, or null for a note with nothing in
 * it. They are said to win over any built-in conventions, since overriding
 * those is what the note is for; an in-tab run's prompt may have none, so
 * the wording doesn't assume there are any.
 */
export function agentRulesSection(
  markdown: string | null | undefined
): string | null {
  const text = markdown?.trim();
  if (!text) return null;
  const clipped = text.length > MAX_AGENT_RULES_CHARS;
  return [
    `These rules are from the user's note titled "${AGENT_RULES_TITLE}". Follow them;`,
    'they take precedence over any built-in conventions you were given.',
    '',
    '<agent-rules>',
    clipped ? text.slice(0, MAX_AGENT_RULES_CHARS) : text,
    ...(clipped ? ['[the rest of the note was cut]'] : []),
    '</agent-rules>',
  ].join('\n');
}

/** Whether a note is the rules note: its title, ignoring case and spaces. */
export function isAgentRulesTitle(title: string | null | undefined) {
  return title?.trim().toLowerCase() === AGENT_RULES_TITLE.toLowerCase();
}

/**
 * What a new rules note starts with: the conventions the agents already
 * follow, written out so the user edits them rather than starting blank,
 * and a few of the things people most often want to set.
 */
export const AGENT_RULES_SEED: { heading: string; items: string[] }[] = [
  {
    heading: 'About this note',
    items: [
      "Every agent run reads this note when it starts and follows it; where it differs from an agent's built-in habits, this note wins.",
      'Edit it freely. Changes apply from the next run on.',
    ],
  },
  {
    heading: 'Remembering facts',
    items: [
      'Look in my notes before asking me something; ask only what is not written down.',
      'Save each new fact about a person or topic to the note about them, or a new note titled with the subject, linked under the note "Agent memory".',
      'Write facts plainly and date them, e.g. "Cosmo: my son, 7 years old (as of 2026-10-02)."',
    ],
  },
  {
    heading: 'Tasks',
    items: [
      'Task status: [ ] to do, [-] in progress, [X] done. Claim a task by marking it [-] and adding @<agent name>.',
      'A task that ships code climbs COMMITTED, MERGED, DEPLOYED, and is [X] only once it is live and checked.',
      'Keep working notes for a task in the note linked from it.',
    ],
  },
  {
    heading: 'Writing',
    items: [
      'The notes are mine: write "I (the agent)" when speaking for yourself, never a bare "I".',
      'Research notes go: (say where, e.g. under a note titled "Research")',
      'Name new notes: (say how, e.g. sentence case, no dates in titles)',
      'Tags to use: (list them, e.g. #research, #idea)',
    ],
  },
];

/**
 * Finds, reads and creates the workspace's "Agent rules" note. Reading never
 * throws: a run with no note, or one that won't load, goes without it.
 */
export class AgentRulesService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  /** The rules note, if there is one outside the trash. */
  find(): DocRecord | undefined {
    return this.docsService.list.docs$.value.find(
      record => !record.trash$.value && isAgentRulesTitle(record.title$.value)
    );
  }

  /** The note's text as markdown, or null with no note or nothing in it. */
  async read(): Promise<string | null> {
    const record = this.find();
    if (!record) return null;
    try {
      const { doc, release } = this.docsService.open(record.id);
      try {
        const loaded = await Promise.race([
          doc.waitForSyncReady().then(() => true),
          new Promise<boolean>(resolve =>
            setTimeout(() => resolve(false), LOAD_WAIT_MS)
          ),
        ]);
        if (!loaded) return null;
        return (await storeMarkdown(doc.blockSuiteDoc)).trim() || null;
      } finally {
        release();
      }
    } catch {
      return null;
    }
  }

  /**
   * The rules note's id, creating it first, seeded with the current
   * conventions (see {@link AGENT_RULES_SEED}), when there is none.
   */
  async openOrCreate(): Promise<string> {
    const existing = this.find();
    if (existing) return existing.id;

    const record = this.docsService.createDoc({ title: AGENT_RULES_TITLE });
    const { doc, release } = this.docsService.open(record.id);
    try {
      const disposePriorityLoad = doc.addPriorityLoad(10);
      await doc.waitForSyncReady();
      disposePriorityLoad();
      const store = doc.blockSuiteDoc;
      const [note] = store.getBlocksByFlavour('notesgraph:note');
      if (!note) return record.id;
      for (const section of AGENT_RULES_SEED) {
        store.addBlock(
          'notesgraph:paragraph' as never, // TODO(eyhn): fix type
          { type: 'h2', text: new Text(section.heading) },
          note.id
        );
        for (const item of section.items) {
          store.addBlock(
            'notesgraph:list' as never, // TODO(eyhn): fix type
            { type: 'bulleted', text: new Text(item) },
            note.id
          );
        }
      }
      return record.id;
    } finally {
      release();
    }
  }
}
