import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import { BaseModel } from './base';

export type ProjectMemberRole = 'member' | 'admin';

declare global {
  interface Events {
    'project.created': {
      workspaceId: string;
      projectId: string;
    };
    'project.deleted': {
      workspaceId: string;
      projectId: string;
    };
  }
}

/**
 * A named sub-group of workspace members with its own doc visibility
 * (`ProjectMember`/`ProjectDoc`). This model only owns the CRUD for those
 * three tables — the actual doc-role fan-out when membership/doc
 * assignment changes lives in `core/projects/service.ts` (`ProjectService`),
 * which composes this with `models.doc`/`models.docUser`.
 */
@Injectable()
export class ProjectModel extends BaseModel {
  @Transactional()
  async create(workspaceId: string, name: string, createdBy: string) {
    const project = await this.db.project.create({
      data: { workspaceId, name, createdBy },
    });
    await this.db.projectMember.create({
      data: { projectId: project.id, userId: createdBy, role: 'admin' },
    });
    return project;
  }

  async get(id: string) {
    return this.db.project.findUnique({ where: { id } });
  }

  async list(workspaceId: string) {
    return this.db.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listForUser(workspaceId: string, userId: string) {
    return this.db.project.findMany({
      where: { workspaceId, members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Transactional()
  async rename(id: string, name: string) {
    return this.db.project.update({ where: { id }, data: { name } });
  }

  @Transactional()
  async delete(id: string) {
    // Cascades ProjectMember/ProjectDoc rows; does NOT revert affected docs'
    // default role or per-member grants — ProjectService handles that first.
    await this.db.project.delete({ where: { id } });
  }

  async listMembers(projectId: string) {
    return this.db.projectMember.findMany({ where: { projectId } });
  }

  async getMember(projectId: string, userId: string) {
    return this.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
  }

  @Transactional()
  async addMember(
    projectId: string,
    userId: string,
    role: ProjectMemberRole = 'member'
  ) {
    return this.db.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      update: { role },
      create: { projectId, userId, role },
    });
  }

  @Transactional()
  async removeMember(projectId: string, userId: string) {
    await this.db.projectMember.deleteMany({ where: { projectId, userId } });
  }

  async listDocs(projectId: string) {
    return this.db.projectDoc.findMany({ where: { projectId } });
  }

  /** A doc may only belong to one project at a time (see `ProjectService.moveDocToProject`). */
  async getDocProject(workspaceId: string, docId: string) {
    return this.db.projectDoc.findFirst({ where: { workspaceId, docId } });
  }

  @Transactional()
  async addDoc(projectId: string, workspaceId: string, docId: string) {
    return this.db.projectDoc.upsert({
      where: { projectId_docId: { projectId, docId } },
      update: {},
      create: { projectId, workspaceId, docId },
    });
  }

  @Transactional()
  async removeDoc(projectId: string, docId: string) {
    await this.db.projectDoc.deleteMany({ where: { projectId, docId } });
  }
}
