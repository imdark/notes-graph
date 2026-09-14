import {
  type ProjectInfo,
  type ProjectsService as EditorProjectsService,
  ProjectsProvider,
} from '@blocksuite/notesgraph/shared/services';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import type { FrameworkProvider } from '@notesgraph/infra';
import { Observable } from 'rxjs';

/**
 * Bridges the workspace's project list into the editor so in-doc blocks (the
 * Block Query block's project picker, and its project→docs scoping) can read
 * and react to projects without reaching across the DI boundary themselves.
 */
export function patchProjectsService(
  framework: FrameworkProvider
): ExtensionType {
  const projectsService = framework.get(ProjectsService);

  const impl: EditorProjectsService = {
    projects$: () =>
      new Observable<ProjectInfo[]>(subscriber => {
        const subscription = projectsService.projects.projects$.subscribe(
          list => {
            subscriber.next(
              (list ?? []).map(project => ({
                id: project.id,
                name: project.name,
                docIds: project.docIds,
              }))
            );
          }
        );
        return () => subscription.unsubscribe();
      }),
  };

  return {
    setup: di => {
      di.addImpl(ProjectsProvider, () => impl);
    },
  };
}
