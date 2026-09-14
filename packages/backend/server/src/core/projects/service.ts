import { Injectable, NotFoundException } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import { Models } from '../../models';
import type { ProjectMemberRole } from '../../models/project';
import { DocRole } from '../permission';

/** DocRole granted to a project member for that project's docs. */
const PROJECT_MEMBER_DOC_ROLE: Record<ProjectMemberRole, DocRole> = {
  member: DocRole.Editor,
  admin: DocRole.Manager,
};

/**
 * A doc with no project is "personal" — visible per the workspace's normal
 * default doc role. Once a doc joins a project, that default is dropped to
 * `None` so only the project's members (granted explicitly below) retain
 * access; this is the private-channel model confirmed for this feature.
 *
 * MVP fan-out: adding a doc to a project (or a member to a project) writes
 * one `DocGrant` row per member, via the existing `models.docUser` grant
 * primitives — not the native `groupGrants` evaluator path (see plan doc
 * for why: that needs Rust/native-module changes and finishing the
 * currently-stubbed `principalType: 'group'` plumbing, deferred).
 */
const PERSONAL_DEFAULT_DOC_ROLE = DocRole.Manager;

@Injectable()
export class ProjectService {
  constructor(private readonly models: Models) {}

  async createProject(workspaceId: string, name: string, createdBy: string) {
    return await this.models.project.create(workspaceId, name, createdBy);
  }

  /**
   * Creates a new project from a doc plus a caller-selected set of related
   * docs (e.g. its links/backlinks), moving all of them in at once.
   */
  @Transactional()
  async convertDocToProject(
    workspaceId: string,
    name: string,
    createdBy: string,
    docIds: string[]
  ) {
    const project = await this.createProject(workspaceId, name, createdBy);
    const uniqueDocIds = Array.from(new Set(docIds));
    for (const docId of uniqueDocIds) {
      await this.moveDocToProject(workspaceId, docId, project.id);
    }
    return project;
  }

  async getProject(id: string) {
    const project = await this.models.project.get(id);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async listProjects(workspaceId: string) {
    return await this.models.project.list(workspaceId);
  }

  async renameProject(id: string, name: string) {
    return await this.models.project.rename(id, name);
  }

  async isProjectAdmin(projectId: string, userId: string) {
    const member = await this.models.project.getMember(projectId, userId);
    return member?.role === 'admin';
  }

  /** Tears down a project: reverts every member doc's grants, then deletes it. */
  @Transactional()
  async deleteProject(id: string) {
    const [docs, members] = await Promise.all([
      this.models.project.listDocs(id),
      this.models.project.listMembers(id),
    ]);
    for (const doc of docs) {
      await this.revokeDocForMembers(
        doc.workspaceId,
        doc.docId,
        members.map(m => m.userId)
      );
      await this.models.doc.setDefaultRole(
        doc.workspaceId,
        doc.docId,
        PERSONAL_DEFAULT_DOC_ROLE
      );
    }
    await this.models.project.delete(id);
  }

  @Transactional()
  async addMember(
    projectId: string,
    userId: string,
    role: ProjectMemberRole = 'member'
  ) {
    await this.models.project.addMember(projectId, userId, role);
    // Back-fill grants for every doc already in the project.
    const docs = await this.models.project.listDocs(projectId);
    for (const doc of docs) {
      // Don't demote a doc's owner if they're also a member of the project.
      if ((await this.getDocOwnerId(doc.workspaceId, doc.docId)) === userId) {
        continue;
      }
      await this.models.docUser.set(
        doc.workspaceId,
        doc.docId,
        userId,
        PROJECT_MEMBER_DOC_ROLE[role]
      );
    }
  }

  @Transactional()
  async removeMember(projectId: string, userId: string) {
    const docs = await this.models.project.listDocs(projectId);
    await this.revokeDocsForMember(docs, userId);
    await this.models.project.removeMember(projectId, userId);
  }

  /**
   * Assigns a doc to a project. If it already belongs to a different
   * project, it's removed from that one first (a doc belongs to at most
   * one project — see `models/project.ts`).
   */
  @Transactional()
  async moveDocToProject(
    workspaceId: string,
    docId: string,
    toProjectId: string
  ) {
    const existing = await this.models.project.getDocProject(
      workspaceId,
      docId
    );
    if (existing && existing.projectId !== toProjectId) {
      await this.removeDocFromProject(existing.projectId, docId);
    }
    if (existing?.projectId === toProjectId) {
      return;
    }

    await this.models.project.addDoc(toProjectId, workspaceId, docId);
    await this.models.doc.setDefaultRole(workspaceId, docId, DocRole.None);

    const ownerId = await this.getDocOwnerId(workspaceId, docId);
    const members = await this.models.project.listMembers(toProjectId);
    for (const member of members) {
      // Never touch the doc owner's grant — a member-level role would demote
      // them (an Editor member loses `Doc.Publish`, breaking sharing).
      if (member.userId === ownerId) {
        continue;
      }
      await this.models.docUser.set(
        workspaceId,
        docId,
        member.userId,
        PROJECT_MEMBER_DOC_ROLE[member.role as ProjectMemberRole]
      );
    }
  }

  /** The doc's Owner (creator) — never demoted or revoked by project grants. */
  private async getDocOwnerId(workspaceId: string, docId: string) {
    return (await this.models.docUser.getOwner(workspaceId, docId))?.userId;
  }

  /** Removes a doc from its project, reverting it to personal visibility. */
  @Transactional()
  async removeDocFromProject(projectId: string, docId: string) {
    const members = await this.models.project.listMembers(projectId);
    const doc = (await this.models.project.listDocs(projectId)).find(
      d => d.docId === docId
    );
    if (!doc) {
      return;
    }

    await this.revokeDocForMembers(
      doc.workspaceId,
      docId,
      members.map(m => m.userId)
    );
    await this.models.doc.setDefaultRole(
      doc.workspaceId,
      docId,
      PERSONAL_DEFAULT_DOC_ROLE
    );
    await this.models.project.removeDoc(projectId, docId);
  }

  private async revokeDocForMembers(
    workspaceId: string,
    docId: string,
    userIds: string[]
  ) {
    const ownerId = await this.getDocOwnerId(workspaceId, docId);
    for (const userId of userIds) {
      // Never revoke the doc owner's own grant.
      if (userId === ownerId) {
        continue;
      }
      await this.models.docUser.delete(workspaceId, docId, userId);
    }
  }

  private async revokeDocsForMember(
    docs: { workspaceId: string; docId: string }[],
    userId: string
  ) {
    for (const doc of docs) {
      if ((await this.getDocOwnerId(doc.workspaceId, doc.docId)) === userId) {
        continue;
      }
      await this.models.docUser.delete(doc.workspaceId, doc.docId, userId);
    }
  }
}
