import {
  Args,
  Field,
  InputType,
  Mutation,
  ObjectType,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';

import { BadRequest, NotFound, Throttle } from '../../base';
import { Models } from '../../models';
import { CurrentUser } from '../auth';
import { PermissionAccess } from '../permission';
import { WorkspaceType } from '../workspaces';

// Secret names double as environment variable names for agent runs.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_VALUE_LENGTH = 64 * 1024;

function assertName(name: string) {
  if (!NAME_PATTERN.test(name)) {
    throw new BadRequest(
      'Secret names use letters, digits and underscores, and cannot start with a digit.'
    );
  }
}

@ObjectType()
export class WorkspaceSecretType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@InputType()
class SetWorkspaceSecretInput {
  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field(() => String, {
    nullable: true,
    description: 'Leave out to keep the stored value.',
  })
  value?: string | null;

  @Field(() => String, { nullable: true })
  description?: string | null;
}

@Resolver(() => WorkspaceType)
export class WorkspaceSecretResolver {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models
  ) {}

  @ResolveField(() => [WorkspaceSecretType], {
    name: 'secrets',
    description: 'Names and descriptions of the workspace secrets, no values.',
    complexity: 2,
  })
  async secrets(
    @CurrentUser() user: CurrentUser,
    @Parent() workspace: WorkspaceType
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspace.id)
      .allowLocal()
      .assert('Workspace.Settings.Read');
    return await this.models.workspaceSecret.list(workspace.id);
  }

  @Throttle('strict')
  @Mutation(() => WorkspaceSecretType)
  async setWorkspaceSecret(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: SetWorkspaceSecretInput
  ) {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
    assertName(input.name);
    if (input.value && input.value.length > MAX_VALUE_LENGTH) {
      throw new BadRequest('Secret values are limited to 64 KB.');
    }
    if (
      !input.value &&
      !(await this.models.workspaceSecret.get(input.workspaceId, input.name))
    ) {
      throw new BadRequest('A new secret needs a value.');
    }
    return await this.models.workspaceSecret.upsert({
      workspaceId: input.workspaceId,
      name: input.name,
      value: input.value,
      description: input.description,
      userId: user.id,
    });
  }

  @Throttle('strict')
  @Mutation(() => WorkspaceSecretType)
  async renameWorkspaceSecret(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string,
    @Args('newName') newName: string
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
    assertName(newName);
    if (!(await this.models.workspaceSecret.get(workspaceId, name))) {
      throw new NotFound(`No secret named ${name}.`);
    }
    if (
      newName !== name &&
      (await this.models.workspaceSecret.get(workspaceId, newName))
    ) {
      throw new BadRequest(`A secret named ${newName} already exists.`);
    }
    return await this.models.workspaceSecret.rename(
      workspaceId,
      name,
      newName,
      user.id
    );
  }

  @Throttle('strict')
  @Mutation(() => Boolean)
  async deleteWorkspaceSecret(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
    return await this.models.workspaceSecret.delete(workspaceId, name);
  }
}
