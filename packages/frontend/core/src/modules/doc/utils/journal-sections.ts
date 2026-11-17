import { addProjectTaskListBlock } from '@blocksuite/notesgraph/blocks/database';
import {
  type BlockModel,
  type Store,
  Text,
} from '@blocksuite/notesgraph/store';

type Scope = { projectId?: string; noProject?: boolean };

const nameKey = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Give a journal day one section per project, then "Inbox": an `H2` heading
 * (the project name) with an empty to-do under it, followed by that
 * project's Task List (a query database in the list view, titled "todos:",
 * scoped to its open tasks). Inbox's list collects open tasks that belong to
 * no project, and is added even when `sections` is empty (the project list
 * hadn't loaded), so the day always has a Task List.
 *
 * The to-dos go *under* their heading, not beside it. A project scope claims
 * tasks whose ancestor trail names it (see BlockTaskFilter.sectionName), and
 * the indexer builds that trail by walking parents, so a checkbox that is a
 * sibling of the "Ai" heading belongs to nothing, while a child of it belongs
 * to Ai wherever it was written. Scoping the journal by doc can't work: it
 * has a section per project, so it belongs to all of them and none.
 *
 * A page already titled with the day (one an agent made before the app had a
 * journal for it) keeps what it has. A section whose heading is there is
 * completed in place, not added again: the list lines right after its heading
 * (written as markdown, so beside it) are nested under it, and its Task List
 * is added only if the page has none for that scope. Missing sections go in
 * project order around the ones present. A new day has no headings, so every
 * section is appended.
 */
export function scaffoldJournalSections(
  store: Store,
  noteId: string,
  sections: { id: string; name: string }[]
) {
  const note = store.getModelById(noteId);
  if (!note) return;

  const headingFor = (name: string) =>
    note.children.find(
      child =>
        child.flavour === 'notesgraph:paragraph' &&
        (child.props as { type?: string }).type === 'h2' &&
        nameKey(child.text?.toString() ?? '') === nameKey(name)
    );
  const hasTaskList = (scope: Scope) =>
    store.getBlocksByFlavour('notesgraph:database').some(block => {
      const props = block.model.props as {
        queryProjectId?: string;
        queryNoProject?: boolean;
      };
      return scope.noProject
        ? !!props.queryNoProject
        : !!scope.projectId && props.queryProjectId === scope.projectId;
    });

  const all: { name: string; scope: Scope }[] = [
    ...sections.map(section => ({
      name: section.name,
      scope: { projectId: section.id },
    })),
    { name: 'Inbox', scope: { noProject: true } },
  ];
  let insertAt = all.some(section => headingFor(section.name))
    ? 0
    : note.children.length;

  for (const section of all) {
    let heading: BlockModel | null | undefined = headingFor(section.name);
    if (heading) {
      const lines: BlockModel[] = [];
      for (const child of note.children.slice(
        note.children.indexOf(heading) + 1
      )) {
        if (child.flavour !== 'notesgraph:list') break;
        lines.push(child);
      }
      if (lines.length) store.moveBlocks(lines, heading);
    } else {
      const headingId = store.addBlock(
        'notesgraph:paragraph' as never, // TODO(eyhn): fix type
        { type: 'h2', text: new Text(section.name) },
        noteId,
        insertAt
      );
      store.addBlock(
        'notesgraph:list' as never, // TODO(eyhn): fix type
        { type: 'todo', text: new Text('') },
        headingId
      );
      heading = store.getModelById(headingId);
      if (!heading) continue;
    }
    const headingAt = note.children.indexOf(heading);
    if (!hasTaskList(section.scope)) {
      addProjectTaskListBlock(store, noteId, {
        ...section.scope,
        name: 'todos:',
        index: headingAt + 1,
      });
    }
    const listNext =
      note.children[headingAt + 1]?.flavour === 'notesgraph:database';
    insertAt = headingAt + (listNext ? 2 : 1);
  }
}
