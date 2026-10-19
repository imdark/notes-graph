import { Text } from '@blocksuite/notesgraph/store';
import { Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import type { Agent } from '../stores/agents';
import type { AgentTemplate } from './agent-templates';
import type { AgentsService } from './agents';
import { CLAUDE_CODE_MODEL, CLOUD_DEVICE_KEY } from './remote-runner';
import type { AgentRunSessionService } from './run-session';

/**
 * "Fix it" on a failed health check: the failure becomes a to-do in the
 * workspace's Fix-ups note, its details and source under it, and an agent run
 * starts on that to-do, on the machine that failed when it was one. The run
 * asks before anything risky, and waits under "Needs you" once it is done.
 */

export const FIX_UPS_DOC_TITLE = 'Fix-ups';
export const FIX_AGENT_NAME = 'Fix it';

export const FIX_AGENT_INSTRUCTIONS = [
  'You are started on a to-do that a failed health check wrote: a machine',
  'check (load, disk, memory), a monitor that errored, or a problem the',
  "weekly notes health check found in the user's notes. The lines under the",
  'to-do say what failed, where, and link the note it came from.',
  '',
  'How to work:',
  '1. Read the to-do, the lines under it and the linked note. Find out why',
  '   it failed before changing anything: look at the machine (logs, disk',
  '   use, processes) or the notes involved.',
  '2. Say in one or two lines what you found.',
  '3. Fix it when the fix is safe and clearly within what the to-do asks.',
  '   Before anything that deletes data, restarts a service, changes config',
  '   or edits notes the user wrote, ask with mcp__run__ask_user, naming',
  '   exactly what you will do. Never guess at credentials.',
  '4. Check that it is fixed: run the check again, or read the note again.',
  '5. Under the to-do, write what was wrong and what you did, then tick the',
  '   to-do. If you could not fix it, leave it open and say what is left and',
  '   what you need from the user.',
].join('\n');

export const FIX_AGENT_TEMPLATE: AgentTemplate = {
  id: 'fix-it',
  label: 'Fix a failed health check',
  draft: {
    name: FIX_AGENT_NAME,
    instructions: FIX_AGENT_INSTRUCTIONS,
    kind: 'worker',
    // Claude Code: on the failed machine when there is one (see fix()),
    // otherwise on the server's runner, with the notes tools.
    harness: 'remote',
    model: CLAUDE_CODE_MODEL,
    deviceKey: CLOUD_DEVICE_KEY,
    tools: [],
    targets: ['block', 'doc'],
    output: 'panel',
    maxSteps: 40,
    enabled: true,
  },
};

/** What failed, for the to-do "Fix it" writes. */
export interface HealthFailure {
  /** One line: "Disk at 94% on box-1". */
  title: string;
  /** Lines under it: the reading, when it was taken, what was expected. */
  details: string[];
  /** The note the failure came from, linked under the to-do. */
  sourceDocId?: string;
  /** The machine to fix it on; the server's runner when absent. */
  deviceKey?: string;
}

/** The to-do's own line. */
export const fixTaskTitle = (failure: HealthFailure) =>
  `Fix: ${failure.title.replace(/\s+/g, ' ').trim()}`;

/** The "Fix it" agent, found by name or, renamed, by its instructions. */
export function findFixAgent(agents: Agent[]): Agent | undefined {
  return (
    agents.find(agent => agent.name === FIX_AGENT_NAME) ??
    agents.find(agent => agent.instructions === FIX_AGENT_INSTRUCTIONS)
  );
}

export class FixTaskService extends Service {
  constructor(
    private readonly docsService: DocsService,
    private readonly agentsService: AgentsService,
    private readonly sessions: AgentRunSessionService
  ) {
    super();
  }

  private fixUpsDoc(): string {
    const existing = this.docsService.list.docs$.value.find(
      record =>
        !record.trash$.value && record.title$.value === FIX_UPS_DOC_TITLE
    );
    return (
      existing?.id ?? this.docsService.createDoc({ title: FIX_UPS_DOC_TITLE }).id
    );
  }

  private agent(): Agent {
    return (
      findFixAgent(this.agentsService.agents$.value) ??
      this.agentsService.create('personal', FIX_AGENT_TEMPLATE.draft)
    );
  }

  /**
   * Write the failure as a to-do in the Fix-ups note and start the agent on
   * it. Resolves with where the to-do is once the run has been started.
   */
  async fix(failure: HealthFailure): Promise<{ docId: string; blockId: string }> {
    const docId = this.fixUpsDoc();
    const { doc, release } = this.docsService.open(docId);
    let blockId: string;
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const [note] = store.getBlocksByFlavour('notesgraph:note');
      if (!note) throw new Error("Couldn't write to the Fix-ups note.");
      blockId = store.addBlock(
        'notesgraph:list' as never,
        { type: 'todo', checked: false, text: new Text(fixTaskTitle(failure)) },
        note.id
      );
      for (const line of failure.details) {
        store.addBlock(
          'notesgraph:paragraph' as never,
          { text: new Text(line) },
          blockId
        );
      }
      if (failure.sourceDocId) {
        store.addBlock(
          'notesgraph:paragraph' as never,
          {
            // A real reference, so the to-do shows in that note's backlinks.
            text: new Text([
              { insert: 'From ' },
              {
                insert: ' ',
                attributes: {
                  reference: { type: 'LinkedPage', pageId: failure.sourceDocId },
                },
              },
            ] as never),
          },
          blockId
        );
      }
    } finally {
      release();
    }

    const agent = this.agent();
    await this.sessions.start(
      failure.deviceKey ? { ...agent, deviceKey: failure.deviceKey } : agent,
      { kind: 'block', docId, blockId }
    );
    return { docId, blockId };
  }

  /**
   * Work a notes health report's to-dos: the report already lists each
   * finding as one, so the agent runs over the whole note, a task at a time.
   */
  async fixReport(reportDocId: string): Promise<void> {
    await this.sessions.start(this.agent(), { kind: 'doc', docId: reportDocId });
  }
}
