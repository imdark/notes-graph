import { Field, ID, InputType, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum ProjectMemberRoleType {
  member = 'member',
  admin = 'admin',
}

registerEnumType(ProjectMemberRoleType, {
  name: 'ProjectMemberRole',
});

@ObjectType()
export class ProjectMemberType {
  @Field()
  userId!: string;

  @Field(() => ProjectMemberRoleType)
  role!: ProjectMemberRoleType;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class ProjectType {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field()
  createdBy!: string;

  @Field()
  createdAt!: Date;
}

@InputType()
export class CreateProjectInput {
  @Field()
  workspaceId!: string;

  @Field()
  name!: string;
}

@InputType()
export class ConvertDocToProjectInput {
  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  /** The doc being converted; becomes the first member of the new project. */
  @Field()
  docId!: string;

  /** Additional related docs (links/backlinks) to bring in alongside `docId`. */
  @Field(() => [String])
  relatedDocIds!: string[];
}

@InputType()
export class AddProjectMemberInput {
  @Field()
  projectId!: string;

  @Field()
  userId!: string;

  @Field(() => ProjectMemberRoleType, { nullable: true })
  role?: ProjectMemberRoleType;
}
