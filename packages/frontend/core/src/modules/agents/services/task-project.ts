import {
  type BlockModel,
  type Store,
  Text,
} from '@blocksuite/notesgraph/store';
import { Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import type { Project } from '../../projects';
import { projectOf } from './context';
import { type AgentTarget, agentTargetBlockIds } from './target';

/** Where unfiled tasks go in a journal day; not a project. */
const INBOX = 'Inbox';

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const isHeading = (model: BlockModel) =>
  model.flavour === 'notesgraph:paragraph' &&
  /^h[1-6]$/.test((model.props as { type?: string }).type ?? '');

const isEmptyTodo = (model: BlockModel) =>
  model.flavour === 'notesgraph:list' &&
  (model.props as { type?: string }).type === 'todo' &&
  !model.text?.toString().trim();

/** The blocks above `model`, nearest first. */
function* ancestors(store: Store, model: BlockModel) {
  for (
    let current = store.getParent(model);
    current;
    current = store.getParent(current)
  ) {
    yield current;
  }
}

const noteOf = (store: Store, model: BlockModel) =>
  [...ancestors(store, model)].find(a => a.flavour === 'notesgraph:note') ??
  null;

/**
 * Put blocks in another project, the way {@link projectOf} reads one: under
 * the note's heading named for the project, or a new one at the end of the
 * note when it has none. Null is Inbox: under the note's "Inbox" heading, or
 * else out at the note's top level, after the section the first block was
 * in. A block nested under another being moved goes with it. In a journal
 * the blocks go in above the section's empty to-do, which stays last to type
 * into. False when there was nothing to move.
 */
export function moveToProject(
  store: Store,
  blockIds: string[],
  project: Pick<Project, 'name'> | null
): boolean {
  const models = blockIds
    .map(id => store.getBlock(id)?.model)
    .filter((model): model is BlockModel => !!model);
  const moving = models.filter(
    model => ![...ancestors(store, model)].some(a => models.includes(a))
  );
  const [first, ...rest] = moving;
  const note = first ? noteOf(store, first) : null;
  if (!first || !note) return false;

  const inMoved = (model: BlockModel) =>
    moving.includes(model) ||
    [...ancestors(store, model)].some(a => moving.includes(a));
  const name = project?.name ?? INBOX;
  const heading = store
    .getBlocksByFlavour('notesgraph:paragraph')
    .map(block => block.model)
    .find(
      model =>
        isHeading(model) &&
        sameName(model.text?.toString() ?? '', name) &&
        noteOf(store, model) === note &&
        !inMoved(model)
    );

  let parent: BlockModel;
  if (heading) {
    parent = heading;
    const last = heading.children.at(-1);
    if (last && isEmptyTodo(last) && !moving.includes(last)) {
      store.moveBlocks([first], heading, last, true);
    } else {
      store.moveBlocks([first], heading);
    }
  } else if (project) {
    const id = store.addBlock(
      'notesgraph:paragraph' as never, // TODO(eyhn): fix type
      { type: 'h2', text: new Text(project.name) },
      note.id
    );
    const added = store.getModelById(id);
    if (!added) return false;
    parent = added;
    store.moveBlocks([first], parent);
  } else {
    parent = note;
    const section =
      [first, ...ancestors(store, first)].find(
        a => store.getParent(a) === note
      ) ?? null;
    store.moveBlocks([first], note, section, false);
  }
  let previous = first;
  for (const model of rest) {
    store.moveBlocks([model], parent, previous, false);
    previous = model;
  }
  return true;
}

/**
 * Which project a run's task is in, and moving it to another. A whole note
 * is in a project by being one of its notes, not by where it sits, so it has
 * neither here.
 */
export class TaskProjectService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  /**
   * The project of the target's first block: its id, null for Inbox, or
   * undefined when it has no block left to read. `inboxable` is false in a
   * project's own note, where a task out of every section is still that
   * project's.
   */
  async read(
    target: AgentTarget,
    projects: Project[]
  ): Promise<{ projectId: string | null | undefined; inboxable: boolean }> {
    const [blockId] = agentTargetBlockIds(target);
    const inboxable = !projects.some(project =>
      project.docIds.includes(target.docId)
    );
    if (!blockId) return { projectId: undefined, inboxable };
    const { doc, release } = this.docsService.open(target.docId);
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const model = store.getBlock(blockId)?.model;
      return {
        projectId: model
          ? (projectOf(store, target.docId, model, projects)?.id ?? null)
          : undefined,
        inboxable,
      };
    } finally {
      release();
    }
  }

  /** Move the target's blocks into `project` (null: Inbox); see {@link moveToProject}. */
  async move(
    target: AgentTarget,
    project: Pick<Project, 'name'> | null
  ): Promise<boolean> {
    const blockIds = agentTargetBlockIds(target);
    if (!blockIds.length) return false;
    const { doc, release } = this.docsService.open(target.docId);
    try {
      await doc.waitForSyncReady();
      return moveToProject(doc.blockSuiteDoc, blockIds, project);
    } finally {
      release();
    }
  }
}
