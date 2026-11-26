import { addProjectTaskListBlock } from '@blocksuite/notesgraph/blocks/database';
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

type Scope = { projectId?: string; noProject?: boolean };

const listsScope = (model: BlockModel, scope: Scope) => {
  if (model.flavour !== 'notesgraph:database') return false;
  const props = model.props as {
    queryProjectId?: string;
    queryNoProject?: boolean;
  };
  return scope.noProject
    ? !!props.queryNoProject
    : !!scope.projectId && props.queryProjectId === scope.projectId;
};

/**
 * A journal day as scaffoldJournalSections lays one out: its Inbox section,
 * the heading or the Task List of tasks in no project, sits in the note.
 */
const isJournal = (note: BlockModel) =>
  note.children.some(
    child =>
      (isHeading(child) && sameName(child.text?.toString() ?? '', INBOX)) ||
      listsScope(child, { noProject: true })
  );

/**
 * Give a journal the section it lacks, as scaffoldJournalSections makes one:
 * an h2 with an empty to-do under it, then the section's "todos:" Task List
 * unless the page already has one for it. It goes in above Inbox, which
 * stays last; Inbox's own heading goes above Inbox's Task List if there is
 * one. Returns the heading.
 */
function addJournalSection(
  store: Store,
  note: BlockModel,
  name: string,
  scope: Scope
): BlockModel | null {
  const inboxAt = (scope.noProject ? [] : note.children).findIndex(
    child => isHeading(child) && sameName(child.text?.toString() ?? '', INBOX)
  );
  const listAt = note.children.findIndex(child =>
    listsScope(child, { noProject: true })
  );
  const at = inboxAt >= 0 ? inboxAt : listAt >= 0 ? listAt : undefined;

  const headingId = store.addBlock(
    'notesgraph:paragraph' as never, // TODO(eyhn): fix type
    { type: 'h2', text: new Text(name) },
    note.id,
    at
  );
  store.addBlock(
    'notesgraph:list' as never, // TODO(eyhn): fix type
    { type: 'todo', text: new Text('') },
    headingId
  );
  const heading = store.getModelById(headingId);
  if (!heading) return null;
  const hasList = store
    .getBlocksByFlavour('notesgraph:database')
    .some(block => listsScope(block.model, scope));
  if (!hasList) {
    addProjectTaskListBlock(store, note.id, {
      ...scope,
      name: 'todos:',
      index: note.children.indexOf(heading) + 1,
    });
  }
  return heading;
}

/**
 * Put blocks in another project, the way {@link projectOf} reads one: under
 * the note's heading named for the project, or a new one at the end of the
 * note when it has none. Null is Inbox: under the note's "Inbox" heading, or
 * else out at the note's top level, after the section the first block was
 * in. A block nested under another being moved goes with it. In a journal
 * the blocks go in above the section's empty to-do, which stays last to type
 * into; a section the day lacks (Inbox too) is made whole, heading, empty
 * to-do and Task List, and a moved list line becomes a to-do. False when
 * there was nothing to move.
 */
export function moveToProject(
  store: Store,
  blockIds: string[],
  project: Pick<Project, 'id' | 'name'> | null
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
  const journal = isJournal(note);
  const heading =
    store
      .getBlocksByFlavour('notesgraph:paragraph')
      .map(block => block.model)
      .find(
        model =>
          isHeading(model) &&
          sameName(model.text?.toString() ?? '', name) &&
          noteOf(store, model) === note &&
          !inMoved(model)
      ) ??
    (journal
      ? addJournalSection(
          store,
          note,
          name,
          project ? { projectId: project.id } : { noProject: true }
        )
      : null);

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
  if (journal) {
    for (const model of moving) {
      const { type } = model.props as { type?: string };
      if (model.flavour === 'notesgraph:list' && type !== 'todo') {
        store.updateBlock(model, { type: 'todo', checked: false });
      }
    }
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
