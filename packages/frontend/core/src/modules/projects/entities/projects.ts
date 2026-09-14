import { Entity, LiveData } from '@notesgraph/infra';

import type { WorkspaceService } from '../../workspace';
import type { Project, ProjectsStore } from '../stores/projects';

export type { Project } from '../stores/projects';

export class Projects extends Entity {
  constructor(
    private readonly store: ProjectsStore,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
    if (this.store.isLocal) {
      // Local projects live in a reactive Yjs-backed DB table — subscribe so
      // the list stays live without manual revalidation.
      const subscription = this.store.watchProjects().subscribe({
        next: projects => {
          this.projects$.setValue(projects);
          this.error$.setValue(null);
        },
        error: err => this.error$.setValue(err),
      });
      this.disposables.push(() => subscription.unsubscribe());
    } else {
      this.revalidate().catch(err => this.error$.setValue(err));
    }
  }

  projects$ = new LiveData<Project[] | undefined>(undefined);
  isLoading$ = new LiveData(false);
  error$ = new LiveData<unknown>(null);

  revalidate = async () => {
    if (this.store.isLocal) {
      // Watch subscription keeps `projects$` current; nothing to fetch.
      return;
    }
    this.isLoading$.setValue(true);
    try {
      const projects = await this.store.listProjects(
        this.workspaceService.workspace.id
      );
      this.projects$.setValue(projects);
      this.error$.setValue(null);
    } catch (err) {
      this.error$.setValue(err);
    } finally {
      this.isLoading$.setValue(false);
    }
  };
}
