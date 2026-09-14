import type { ProjectMemberRole } from '@notesgraph/graphql';
import { Service } from '@notesgraph/infra';

import type { WorkspaceService } from '../../workspace';
import { Projects } from '../entities/projects';
import type { ProjectsStore } from '../stores/projects';

export class ProjectsService extends Service {
  constructor(
    private readonly store: ProjectsStore,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  projects = this.framework.createEntity(Projects);

  async createProject(name: string) {
    const project = await this.store.createProject(
      this.workspaceService.workspace.id,
      name
    );
    await this.projects.revalidate();
    return project;
  }

  async convertDocToProject(
    name: string,
    docId: string,
    relatedDocIds: string[]
  ) {
    const project = await this.store.convertDocToProject({
      workspaceId: this.workspaceService.workspace.id,
      name,
      docId,
      relatedDocIds,
    });
    await this.projects.revalidate();
    return project;
  }

  /** The project (if any) that currently owns `docId`. */
  getProjectForDoc(docId: string) {
    return (this.projects.projects$.value ?? []).find(project =>
      project.docIds.includes(docId)
    );
  }

  async renameProject(id: string, name: string) {
    await this.store.renameProject(id, name);
    await this.projects.revalidate();
  }

  async deleteProject(id: string) {
    await this.store.deleteProject(id);
    await this.projects.revalidate();
  }

  async addProjectMember(
    projectId: string,
    userId: string,
    role?: ProjectMemberRole
  ) {
    await this.store.addProjectMember(projectId, userId, role);
    await this.projects.revalidate();
  }

  async removeProjectMember(projectId: string, userId: string) {
    await this.store.removeProjectMember(projectId, userId);
    await this.projects.revalidate();
  }

  async assignDocToProject(docId: string, projectId: string) {
    await this.store.assignDocToProject(
      this.workspaceService.workspace.id,
      docId,
      projectId
    );
    await this.projects.revalidate();
  }

  async removeDocFromProject(projectId: string, docId: string) {
    await this.store.removeDocFromProject(projectId, docId);
    await this.projects.revalidate();
  }
}
