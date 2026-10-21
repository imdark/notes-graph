import { Framework, LiveData } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { DocsService } from '../../doc';
import {
  AGENT_RULES_SEED,
  AGENT_RULES_TITLE,
  agentRulesSection,
  AgentRulesService,
  isAgentRulesTitle,
  MAX_AGENT_RULES_CHARS,
} from './agent-rules';

const record = (id: string, title: string, trash = false) => ({
  id,
  title$: new LiveData(title),
  trash$: new LiveData(trash),
});

/**
 * A DocsService over fake records. Opening a note hands back a store that
 * records the blocks added to it, and `released` counts the releases, so a
 * read that bails out early is still seen to let go of the doc.
 */
const fakeDocs = (records: ReturnType<typeof record>[]) => {
  const added: { flavour: string; props: any }[] = [];
  const created: string[] = [];
  let released = 0;
  const docs: any = {
    list: { docs$: new LiveData(records) },
    open: () => ({
      doc: {
        addPriorityLoad: () => () => {},
        waitForSyncReady: async () => {},
        blockSuiteDoc: {
          getBlocksByFlavour: () => [{ id: 'note' }],
          addBlock: (flavour: string, props: any) =>
            added.push({ flavour, props }),
        },
      },
      release: () => released++,
    }),
    createDoc: ({ title }: { title: string }) => {
      created.push(title);
      return record('new', title);
    },
  };
  return { docs, added, created, released: () => released };
};

const rulesService = (docs: unknown) => {
  const framework = new Framework();
  framework
    .service(DocsService, docs as any)
    .service(AgentRulesService, [DocsService]);
  return framework.provider().get(AgentRulesService);
};

describe('agentRulesSection', () => {
  test('nothing for no note or an empty one', () => {
    expect(agentRulesSection(null)).toBeNull();
    expect(agentRulesSection(' \n ')).toBeNull();
  });

  test('wraps the note and says it wins', () => {
    const section = agentRulesSection('  Tag research #research \n')!;
    expect(section).toContain(`"${AGENT_RULES_TITLE}"`);
    expect(section).toContain('take precedence over any built-in conventions');
    expect(section).not.toContain('above');
    expect(section.endsWith('<agent-rules>\nTag research #research\n</agent-rules>')).toBe(true);
  });

  test('cuts a long note and says so', () => {
    const section = agentRulesSection('x'.repeat(MAX_AGENT_RULES_CHARS + 10))!;
    expect(section).toContain('x'.repeat(MAX_AGENT_RULES_CHARS));
    expect(section).not.toContain('x'.repeat(MAX_AGENT_RULES_CHARS + 1));
    expect(section.endsWith('[the rest of the note was cut]\n</agent-rules>')).toBe(true);
  });
});

describe('AgentRulesService', () => {
  test('finds the note by title, ignoring case and spaces, but not in the trash', () => {
    expect(isAgentRulesTitle('  agent RULES ')).toBe(true);
    expect(isAgentRulesTitle('Agent rules draft')).toBe(false);
    const { docs } = fakeDocs([
      record('old', 'Agent rules', true),
      record('other', 'Agent memory'),
      record('rules', 'agent rules'),
    ]);
    expect(rulesService(docs).find()?.id).toBe('rules');
  });

  test('reads nothing without a note', async () => {
    const { docs } = fakeDocs([record('other', 'Agent memory')]);
    expect(await rulesService(docs).read()).toBeNull();
  });

  test('opens the note it has rather than making another', async () => {
    const { docs, created, added } = fakeDocs([record('rules', 'Agent rules')]);
    expect(await rulesService(docs).openOrCreate()).toBe('rules');
    expect(created).toEqual([]);
    expect(added).toEqual([]);
  });

  test('creates a missing note seeded with the current conventions', async () => {
    const { docs, created, added, released } = fakeDocs([]);
    expect(await rulesService(docs).openOrCreate()).toBe('new');
    expect(created).toEqual([AGENT_RULES_TITLE]);
    // A heading per section, then its items as bullets, in order. (A Text
    // not yet in a doc reads as empty, so the words are checked on the seed.)
    expect(added.map(block => block.props.type)).toEqual(
      AGENT_RULES_SEED.flatMap(section => [
        'h2',
        ...section.items.map(() => 'bulleted'),
      ])
    );
    // The conventions the device prompt hard-codes are there to edit.
    const seed = AGENT_RULES_SEED.flatMap(section => [
      section.heading,
      ...section.items,
    ]).join('\n');
    expect(seed).toContain('Agent memory');
    expect(seed).toContain('(as of 2026-10-02)');
    expect(seed).toContain('[-] in progress');
    expect(released()).toBe(1);
  });
});
