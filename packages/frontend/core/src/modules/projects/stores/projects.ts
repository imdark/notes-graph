import {
  addProjectMemberMutation,
  assignDocToProjectMutation,
  type ConvertDocToProjectInput,
  convertDocToProjectMutation,
  createProjectMutation,
  deleteProjectMutation,
  type ProjectMemberRole,
  removeDocFromProjectMutation,
  removeProjectMemberMutation,
  renameProjectMutation,
  workspaceProjectsQuery,
} from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';
import { map, type Observable } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { WorkspaceDBService } from '../../db';
import type { WorkspaceService } from '../../workspace';

export interface ProjectMemberInfo {
  userId: string;
  role: string;
  createdAt: string;
}

/**
 * Flavour-agnostic project shape. Cloud workspaces populate `members` from the
 * server; local workspaces leave it empty (member sharing requires the cloud).
 */
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  members: ProjectMemberInfo[];
  docIds: string[];
}

interface LocalProjectRow {
  id: string;
  name: string;
  docIds?: string[] | null;
  createdAt?: string | null;
}

/**
 * Reads/writes projects from whichever backend fits the workspace: the GraphQL
 * server for cloud workspaces, or a local Yjs-backed DB table for local
 * (offline) workspaces. Callers don't need to care which — the branch is
 * internal, mirroring `WorkspaceDBService.userdataDB$`.
 */
export class ProjectsStore extends Store {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly workspaceDBService: WorkspaceDBService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  get isLocal() {
    return (
      this.workspaceService.workspace.flavour === 'local' ||
      !this.workspaceServerService.server
    );
  }

  private get server() {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error('No Server');
    }
    return server;
  }

  private get table() {
    return this.workspaceDBService.db.projects;
  }

  private get workspaceId() {
    return this.workspaceService.workspace.id;
  }

  private toProject(row: LocalProjectRow): Project {
    return {
      id: row.id,
      workspaceId: this.workspaceId,
      name: row.name,
      createdBy: '',
      createdAt: row.createdAt ?? '',
      members: [],
      docIds: row.docIds ?? [],
    };
  }

  // --- reads -------------------------------------------------------------

  watchProjects(): Observable<Project[]> {
    return this.table
      .find$()
      .pipe(map(rows => rows.map(row => this.toProject(row))));
  }

  async listProjects(workspaceId: string, signal?: AbortSignal) {
    if (this.isLocal) {
      return this.table.find().map(row => this.toProject(row));
    }
    const data = await this.server.gql({
      query: workspaceProjectsQuery,
      variables: { workspaceId },
      context: { signal },
    });
    return data.workspace.projects as Project[];
  }

  // --- project CRUD ------------------------------------------------------

  async createProject(workspaceId: string, name: string) {
    if (this.isLocal) {
      const row = this.table.create({
        name,
        docIds: [],
        createdAt: new Date().toISOString(),
      });
      return this.toProject(row);
    }
    const data = await this.server.gql({
      query: createProjectMutation,
      variables: { workspaceId, name },
    });
    return data.createProject as Project;
  }

  async convertDocToProject(input: ConvertDocToProjectInput) {
    if (this.isLocal) {
      const docIds = Array.from(
        new Set([input.docId, ...input.relatedDocIds])
      );
      const project = await this.createProject(input.workspaceId, input.name);
      for (const docId of docIds) {
        await this.assignDocToProject(input.workspaceId, docId, project.id);
      }
      return project;
    }
    const data = await this.server.gql({
      query: convertDocToProjectMutation,
      variables: { input },
    });
    return data.convertDocToProject as Project;
  }

  async renameProject(id: string, name: string) {
    if (this.isLocal) {
      this.table.update(id, { name });
      return;
    }
    const data = await this.server.gql({
      query: renameProjectMutation,
      variables: { id, name },
    });
    return data.renameProject;
  }

  async deleteProject(id: string) {
    if (this.isLocal) {
      this.table.delete(id);
      return;
    }
    const data = await this.server.gql({
      query: deleteProjectMutation,
      variables: { id },
    });
    return data.deleteProject;
  }

  // --- doc membership ----------------------------------------------------

  async assignDocToProject(
    workspaceId: string,
    docId: string,
    projectId: string
  ) {
    if (this.isLocal) {
      // A doc belongs to at most one project — drop it from any others first.
      for (const row of this.table.find()) {
        if (row.id !== projectId && (row.docIds ?? []).includes(docId)) {
          this.table.update(row.id, {
            docIds: (row.docIds ?? []).filter(id => id !== docId),
          });
        }
      }
      const target = this.table.get(projectId);
      if (target) {
        const next = new Set([...(target.docIds ?? []), docId]);
        this.table.update(projectId, { docIds: Array.from(next) });
      }
      return;
    }
    const data = await this.server.gql({
      query: assignDocToProjectMutation,
      variables: { workspaceId, docId, projectId },
    });
    return data.assignDocToProject;
  }

  async removeDocFromProject(projectId: string, docId: string) {
    if (this.isLocal) {
      const target = this.table.get(projectId);
      if (target) {
        this.table.update(projectId, {
          docIds: (target.docIds ?? []).filter(id => id !== docId),
        });
      }
      return;
    }
    const data = await this.server.gql({
      query: removeDocFromProjectMutation,
      variables: { projectId, docId },
    });
    return data.removeDocFromProject;
  }

  // --- members (cloud only) ---------------------------------------------

  async addProjectMember(
    projectId: string,
    userId: string,
    role?: ProjectMemberRole
  ) {
    const data = await this.server.gql({
      query: addProjectMemberMutation,
      variables: { projectId, userId, role },
    });
    return data.addProjectMember;
  }

  async removeProjectMember(projectId: string, userId: string) {
    const data = await this.server.gql({
      query: removeProjectMemberMutation,
      variables: { projectId, userId },
    });
    return data.removeProjectMember;
  }
}
