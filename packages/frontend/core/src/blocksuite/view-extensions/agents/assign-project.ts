import { FolderIcon } from '@blocksuite/icons/lit';
import {
  menu,
  type MenuConfig,
} from '@blocksuite/notesgraph/components/context-menu';
import type { BlockStdScope } from '@blocksuite/notesgraph/std';
import type { BlockModel } from '@blocksuite/notesgraph/store';
import { notify } from '@notesgraph/component';
import { moveToProject, projectOf } from '@notesgraph/core/modules/agents';
import {
  type Project,
  ProjectsService,
} from '@notesgraph/core/modules/projects';
import type { FrameworkProvider } from '@notesgraph/infra';
import { signal } from '@preact/signals-core';
import { html } from 'lit';

/**
 * Resolves once the workspace's projects are loaded, for a menu that waits
 * a moment for them before opening.
 */
export function projectsLoaded(framework: FrameworkProvider): Promise<void> {
  const { projects } = framework.get(ProjectsService);
  return projects.projects$.value ? Promise.resolve() : projects.revalidate();
}

/**
 * The first row of the "Assign to agent" menu: the project the task is in,
 * opening the projects to move it to before it is handed over, so the agent
 * reads it as that project's task. Picking one leaves the menu open on the
 * agents. Null when the workspace has no projects or the note is read-only.
 */
export function assignProjectMenu(
  framework: FrameworkProvider,
  std: BlockStdScope,
  model: BlockModel
): MenuConfig | null {
  const projects = framework.get(ProjectsService).projects.projects$.value;
  if (!projects?.length || std.store.readonly) return null;

  const docId = std.store.id;
  const current = signal(projectOf(std.store, docId, model, projects));
  // A task out of every section of a project's own note is still that
  // project's, so Inbox is no place it can be moved to there.
  const inboxable = !projects.some(project => project.docIds.includes(docId));
  const sorted = [...projects].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const pick = (project: Project | null) => {
    if (project?.id === current.value?.id) return;
    if (!moveToProject(std.store, [model.id], project)) {
      notify.error({ title: "Couldn't move the task" });
      return;
    }
    current.value = projectOf(std.store, docId, model, projects);
  };

  return menu.subMenu({
    name: 'Project',
    label: () =>
      html`Project: <strong>${current.value?.name ?? 'Inbox'}</strong>`,
    prefix: FolderIcon(),
    closeOnSelect: false,
    options: {
      title: { text: 'Move the task to' },
      items: [
        menu.dynamic(() => [
          ...(inboxable || !current.value
            ? [
                menu.action({
                  name: 'Inbox',
                  isSelected: !current.value,
                  select: () => pick(null),
                }),
              ]
            : []),
          ...sorted.map(project =>
            menu.action({
              name: project.name,
              prefix: FolderIcon(),
              isSelected: current.value?.id === project.id,
              select: () => pick(project),
            })
          ),
        ]),
      ],
    },
  });
}
