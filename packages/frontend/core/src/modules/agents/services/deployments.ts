import type { BlockModel } from '@blocksuite/notesgraph/store';
import { LiveData, Service } from '@notesgraph/infra';
import type { Query, SearchOptions } from '@notesgraph/nbstore';
import {
  catchError,
  combineLatest,
  filter,
  map,
  of,
  startWith,
  timeout,
} from 'rxjs';

import type { DocsService } from '../../doc';
import type { DocsSearchService } from '../../docs-search';
import type { Agent } from '../stores/agents';
import type { AgentContext } from './context';
import { isDeviceClaudeModel, RESEARCH_MODEL } from './remote-runner';
import type { AgentRunSessionService } from './run-session';
import type { AgentTarget } from './target';
import { readTaskStatus, taskTitle } from './task-claim';

/**
 * Where a task that ships code is on its way out, by the org keyword it
 * carries (indexed kebab-cased): on a branch with a PR, landed on main, or
 * live and waiting to be checked. See update_task in the MCP tools.
 */
export type ShipStage = 'committed' | 'merged' | 'deployed';

export const SHIP_STAGES: ShipStage[] = ['committed', 'merged', 'deployed'];

export const isShipStage = (status: string | undefined): status is ShipStage =>
  !!status && (SHIP_STAGES as string[]).includes(status);

/** A task on its way to production, as the index knows it. */
export interface ShipTask {
  docId: string;
  blockId: string;
  stage: ShipStage;
  /** The task's text as indexed; {@link ShipTaskDetails.title} once read. */
  text: string;
}

/** What reading a task's note adds: what it is called and where its PR is. */
export interface ShipTaskDetails {
  title: string;
  docTitle: string;
  /** The first GitHub pull request named in the task or the notes under it. */
  pullRequest: string | null;
}

/** What a ship run is asked to do with the tasks it is given. */
export type ShipAction = 'merge' | 'deploy';

const PULL_REQUEST_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

export const findPullRequest = (text: string): string | null =>
  PULL_REQUEST_RE.exec(text)?.[0] ?? null;

/** The text of a block and everything nested under it, one block a line. */
const subtreeText = (model: BlockModel): string =>
  [model.text?.toString() ?? '', ...model.children.map(subtreeText)].join('\n');

/**
 * The agents a ship run can go to: Claude Code on a device, which has the
 * repo, git and the deploy scripts. Research runs read rather than edit, and
 * an in-tab or cloud agent can reach none of that. Plain Claude Code comes
 * before Workflow, which would open a ticket and worktree for the run.
 */
export const shipAgents = (agents: Agent[]): Agent[] =>
  agents
    .filter(
      agent =>
        agent.enabled &&
        agent.harness === 'remote' &&
        !!agent.deviceKey &&
        isDeviceClaudeModel(agent.model) &&
        agent.model !== RESEARCH_MODEL
    )
    .sort(
      (a, b) =>
        Number(b.model === 'claude-code') - Number(a.model === 'claude-code')
    );

/**
 * The tasks a ship run acts on: for a merge, those with a PR still open; for
 * a deploy, those merged and those still to merge, which it merges first.
 * Deployed tasks are already out.
 */
export const shipTargets = <T extends { stage: ShipStage }>(
  tasks: T[],
  action: ShipAction
): T[] =>
  tasks.filter(task =>
    action === 'merge'
      ? task.stage === 'committed'
      : task.stage === 'committed' || task.stage === 'merged'
  );

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** What the agent of a ship run reads: the tasks, and what to do with them. */
export function shipBrief(
  tasks: (ShipTask & ShipTaskDetails)[],
  action: ShipAction
): AgentContext {
  const toMerge = tasks.filter(task => task.stage === 'committed');
  const title =
    action === 'merge'
      ? `Merge ${plural(toMerge.length, 'feature')}`
      : toMerge.length > 0
        ? `Merge and deploy ${plural(tasks.length, 'feature')}`
        : `Deploy ${plural(tasks.length, 'feature')}`;
  const lines = tasks.map((task, i) =>
    [
      `${i + 1}. ${task.title || task.text}`,
      `   - status: ${task.stage.toUpperCase()}`,
      `   - pull request: ${task.pullRequest ?? 'none named; find it from the task’s notes or the branch'}`,
      `   - task: block ${task.blockId} in note "${task.docTitle}" (doc ${task.docId})`,
    ].join('\n')
  );
  const steps =
    action === 'merge'
      ? [
          'Merge each pull request above into main (`gh pr merge`), oldest first. Fetch main again between merges.',
          'If one does not merge cleanly or its checks fail, leave it, say why in a note on its task, and go on with the rest.',
          "Move each task you merged to `merged` with update_task, with a note naming the merge commit. Don't deploy.",
        ]
      : [
          ...(toMerge.length > 0
            ? [
                'First merge the pull request of each COMMITTED task into main (`gh pr merge`), oldest first. If one does not merge cleanly or its checks fail, leave it out of this deploy and say why in a note on its task.',
                'Move each task you merged to `merged` with update_task, with a note naming the merge commit.',
              ]
            : []),
          'Update to the latest main, then deploy it to production the way this repo does (the deploy-prod skill). Never stop a deploy midway.',
          "Once the deploy has finished, move each task that went out to `deployed` with a note naming the deployed commit. Don't mark any done: that waits for someone to check it live.",
          'If the deploy fails, leave the tasks as they are and put what failed in a note on each.',
        ];
  return {
    title,
    label: plural(tasks.length, 'feature'),
    text: [
      `# ${title}`,
      '',
      `Asked for from the Deployments screen in NotesGraph. ${
        action === 'merge'
          ? 'Merge these features.'
          : 'Ship these features to production.'
      }`,
      '',
      '## Features',
      '',
      ...lines,
      '',
      '## What to do',
      '',
      ...steps.map(step => `- ${step}`),
      '- Ask before anything else that cannot be undone. Finish with what shipped and what did not.',
    ].join('\n'),
  };
}

/** The status, task and note fields read off each indexed block. */
const SEARCH_OPTIONS = {
  fields: ['docId', 'blockId', 'content', 'orgStatus'],
  pagination: { limit: 500 },
} satisfies SearchOptions<'block'>;

const SHIP_QUERY = {
  type: 'boolean',
  occur: 'should',
  queries: SHIP_STAGES.map(
    stage => ({ type: 'match', field: 'orgStatus', match: stage }) as const
  ),
} satisfies Query<'block'>;

const firstString = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * Features ready to go out, and the run that takes them there.
 *
 * Ready means a task carrying COMMITTED (its PR is open) or MERGED (on main,
 * not yet live), the keywords agents move a task through as its code ships;
 * DEPLOYED ones are listed too, as live but not yet checked. Shipping hands
 * the chosen tasks to a Claude Code agent on a device — the machine with the
 * repo and the deploy scripts — so it can be asked for from a phone.
 */
export class DeploymentsService extends Service {
  constructor(
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly runSessions: AgentRunSessionService
  ) {
    super();
  }

  /**
   * Every task in a ship stage, from the union of this device's index and the
   * server's: the local one only knows notes opened here, the server's only
   * what it has indexed (see block-task-index-service.ts). Null until either
   * has answered.
   */
  readonly tasks$ = LiveData.from<ShipTask[] | null>(
    combineLatest(
      [undefined, 'remote' as const].map(prefer =>
        this.docsSearchService.indexer
          .search$(
            'block',
            SHIP_QUERY,
            prefer ? { ...SEARCH_OPTIONS, prefer } : SEARCH_OPTIONS
          )
          .pipe(
            map(result =>
              result.nodes.flatMap(node => {
                const stage = firstString(node.fields.orgStatus);
                const docId = firstString(node.fields.docId);
                const blockId = firstString(node.fields.blockId);
                // The index may match tokens loosely; keep exact stages only.
                if (!isShipStage(stage) || !docId || !blockId) return [];
                return [
                  {
                    docId,
                    blockId,
                    stage,
                    text: firstString(node.fields.content),
                  },
                ];
              })
            ),
            timeout({ first: 15_000, with: () => of<ShipTask[]>([]) }),
            catchError(() => of<ShipTask[]>([])),
            startWith<ShipTask[] | null>(null)
          )
      )
    ).pipe(
      filter(results => results.some(tasks => tasks !== null)),
      map(results => {
        const byKey = new Map<string, ShipTask>();
        for (const task of results.flatMap(tasks => tasks ?? [])) {
          byKey.set(`${task.docId}:${task.blockId}`, task);
        }
        return [...byKey.values()];
      })
    ),
    null
  );

  /**
   * Read the tasks' notes for what the index doesn't hold: each task's title
   * without its status, its note's title, and its PR, which agents write in
   * a note under the task. A task whose note now says another status (the
   * index lags edits) is left out.
   */
  async details(
    tasks: ShipTask[]
  ): Promise<Map<string, ShipTaskDetails & { stage: ShipStage }>> {
    const out = new Map<string, ShipTaskDetails & { stage: ShipStage }>();
    const byDoc = new Map<string, ShipTask[]>();
    for (const task of tasks) {
      byDoc.set(task.docId, [...(byDoc.get(task.docId) ?? []), task]);
    }
    await Promise.all(
      [...byDoc].map(async ([docId, docTasks]) => {
        const { doc, release } = this.docsService.open(docId);
        try {
          await doc.waitForSyncReady();
          const docTitle = doc.title$.value || 'Untitled';
          for (const task of docTasks) {
            const model = doc.blockSuiteDoc.getBlock(task.blockId)?.model;
            if (!model) continue;
            const status = readStage(model);
            if (!status) continue;
            out.set(`${task.docId}:${task.blockId}`, {
              stage: status,
              title: taskTitle(model),
              docTitle,
              pullRequest: findPullRequest(subtreeText(model)),
            });
          }
        } catch {
          // A note that can't be opened leaves its tasks as the index has them.
        } finally {
          release();
        }
      })
    );
    return out;
  }

  /**
   * Send the tasks to `agent` to merge, or merge and deploy. The run's record
   * sits on the first task's note, on the tasks in that note, so its Show
   * link lands on one of them; the agent reads the brief, which names all.
   */
  async ship(
    agent: Agent,
    tasks: (ShipTask & ShipTaskDetails)[],
    action: ShipAction
  ): Promise<AgentTarget | null> {
    const chosen = shipTargets(tasks, action);
    const first = chosen[0];
    if (!first) return null;
    const target: AgentTarget = {
      kind: 'selection',
      docId: first.docId,
      blockIds: chosen
        .filter(task => task.docId === first.docId)
        .map(task => task.blockId),
    };
    // Resolves when the run ends; the caller only needs it under way.
    this.runSessions
      .start(agent, target, shipBrief(chosen, action))
      .catch(() => {
        // The run's own record carries any failure.
      });
    return target;
  }
}

/** A block's ship stage from the note itself, if it is in one. */
const readStage = (model: BlockModel): ShipStage | null => {
  const stage = readTaskStatus(model)?.text.trim().toLowerCase();
  return isShipStage(stage) ? stage : null;
};
