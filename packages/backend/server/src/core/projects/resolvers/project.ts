import { Logger } from '@nestjs/common';
import {
  Args,
  Field,
  ID,
  InputType,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';

import { Models } from '../../../models';
import { CurrentUser } from '../../auth';
import { PermissionAccess } from '../../permission';
import { WorkspaceType } from '../../workspaces/types';
import { ProjectService } from '../service';
import {
  AddProjectMemberInput,
  ConvertDocToProjectInput,
  CreateProjectInput,
  ProjectMemberRoleType,
  ProjectMemberType,
  ProjectType,
} from '../types';

@InputType()
class AssignDocToProjectInput {
  @Field()
  workspaceId!: string;

  @Field()
  docId!: string;

  @Field()
  projectId!: string;
}

function toProjectType(project: {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}): ProjectType {
  return project;
}

@Resolver(() => ProjectType)
export class ProjectResolver {
  private readonly logger = new Logger(ProjectResolver.name);

  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models,
    private readonly projects: ProjectService
  ) {}

  private async assertProjectManage(userId: string, projectId: string) {
    const project = await this.projects.getProject(projectId);
    const isProjectAdmin = await this.projects.isProjectAdmin(
      projectId,
      userId
    );
    if (!isProjectAdmin) {
      await this.ac
        .user(userId)
        .workspace(project.workspaceId)
        .assert('Workspace.Users.Manage');
    }
    return project;
  }

  @ResolveField(() => [ProjectMemberType])
  async members(@Parent() project: ProjectType): Promise<ProjectMemberType[]> {
    const members = await this.models.project.listMembers(project.id);
    return members.map(m => ({
      userId: m.userId,
      role: m.role as ProjectMemberRoleType,
      createdAt: m.createdAt,
    }));
  }

  @ResolveField(() => [ID])
  async docIds(@Parent() project: ProjectType): Promise<string[]> {
    const docs = await this.models.project.listDocs(project.id);
    return docs.map(d => d.docId);
  }

  @Query(() => ProjectType, { nullable: true })
  async project(
    @CurrentUser() user: CurrentUser,
    @Args('id') id: string
  ): Promise<ProjectType | null> {
    const project = await this.models.project.get(id);
    if (!project) {
      return null;
    }
    await this.ac
      .user(user.id)
      .workspace(project.workspaceId)
      .assert('Workspace.Read');
    return toProjectType(project);
  }

  @Mutation(() => ProjectType)
  async createProject(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: CreateProjectInput
  ): Promise<ProjectType> {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.CreateDoc');
    const project = await this.projects.createProject(
      input.workspaceId,
      input.name,
      user.id
    );
    this.logger.log(`Created project ${project.id} in ${input.workspaceId}`);
    return toProjectType(project);
  }

  @Mutation(() => ProjectType)
  async renameProject(
    @CurrentUser() user: CurrentUser,
    @Args('id') id: string,
    @Args('name') name: string
  ): Promise<ProjectType> {
    await this.assertProjectManage(user.id, id);
    const project = await this.projects.renameProject(id, name);
    return toProjectType(project);
  }

  @Mutation(() => Boolean)
  async deleteProject(
    @CurrentUser() user: CurrentUser,
    @Args('id') id: string
  ): Promise<boolean> {
    await this.assertProjectManage(user.id, id);
    await this.projects.deleteProject(id);
    return true;
  }

  @Mutation(() => Boolean)
  async addProjectMember(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: AddProjectMemberInput
  ): Promise<boolean> {
    await this.assertProjectManage(user.id, input.projectId);
    await this.projects.addMember(
      input.projectId,
      input.userId,
      input.role ?? ProjectMemberRoleType.member
    );
    return true;
  }

  @Mutation(() => Boolean)
  async removeProjectMember(
    @CurrentUser() user: CurrentUser,
    @Args('projectId') projectId: string,
    @Args('userId') userId: string
  ): Promise<boolean> {
    await this.assertProjectManage(user.id, projectId);
    await this.projects.removeMember(projectId, userId);
    return true;
  }

  /**
   * Creates a new project seeded from `docId` plus `relatedDocIds` (e.g. its
   * links/backlinks, chosen by the caller) in one call.
   */
  @Mutation(() => ProjectType)
  async convertDocToProject(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: ConvertDocToProjectInput
  ): Promise<ProjectType> {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.CreateDoc');

    const docIds = Array.from(new Set([input.docId, ...input.relatedDocIds]));
    for (const docId of docIds) {
      await this.ac
        .user(user.id)
        .doc({ workspaceId: input.workspaceId, docId })
        .assert('Doc.Update');
    }

    const project = await this.projects.convertDocToProject(
      input.workspaceId,
      input.name,
      user.id,
      docIds
    );
    this.logger.log(
      `Converted doc ${input.docId} into project ${project.id} in ${input.workspaceId}`
    );
    return toProjectType(project);
  }

  /**
   * Assigns a doc to a project — used for both "move" (pass the doc's own
   * id) and "copy" (frontend duplicates the doc first via the existing
   * same-workspace duplicate helper, then passes the new doc's id here).
   */
  @Mutation(() => Boolean)
  async assignDocToProject(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: AssignDocToProjectInput
  ): Promise<boolean> {
    await this.assertProjectManage(user.id, input.projectId);
    await this.ac
      .user(user.id)
      .doc({ workspaceId: input.workspaceId, docId: input.docId })
      .assert('Doc.Update');
    await this.projects.moveDocToProject(
      input.workspaceId,
      input.docId,
      input.projectId
    );
    return true;
  }

  @Mutation(() => Boolean)
  async removeDocFromProject(
    @CurrentUser() user: CurrentUser,
    @Args('projectId') projectId: string,
    @Args('docId') docId: string
  ): Promise<boolean> {
    await this.assertProjectManage(user.id, projectId);
    await this.projects.removeDocFromProject(projectId, docId);
    return true;
  }
}

@Resolver(() => WorkspaceType)
export class WorkspaceProjectsResolver {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly projectService: ProjectService
  ) {}

  @ResolveField(() => [ProjectType])
  async projects(
    @CurrentUser() user: CurrentUser,
    @Parent() workspace: WorkspaceType
  ): Promise<ProjectType[]> {
    await this.ac
      .user(user.id)
      .workspace(workspace.id)
      .assert('Workspace.Read');
    const list = await this.projectService.listProjects(workspace.id);
    return list.map(toProjectType);
  }
}
