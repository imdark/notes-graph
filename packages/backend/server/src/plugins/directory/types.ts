import { Field, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { DirectoryProviderName } from './providers';

registerEnumType(DirectoryProviderName, { name: 'DirectoryProviderType' });

@ObjectType()
export class DirectoryAccountObjectType {
  @Field()
  id!: string;

  @Field(() => DirectoryProviderName)
  provider!: DirectoryProviderName;

  @Field()
  domain!: string;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  lastError?: string | null;

  @Field(() => Date, { nullable: true })
  lastSyncAt?: Date | null;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class DirectoryGroupObjectType {
  @Field()
  externalId!: string;

  @Field()
  email!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;
}

@ObjectType()
export class DirectoryOrgUnitObjectType {
  @Field()
  externalId!: string;

  @Field()
  path!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;
}

@ObjectType()
export class DirectorySyncScopeObjectType {
  @Field()
  id!: string;

  @Field()
  directoryAccountId!: string;

  @Field()
  projectId!: string;

  @Field()
  scopeType!: string;

  @Field()
  externalId!: string;

  @Field(() => String, { nullable: true })
  label?: string | null;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  lastError?: string | null;

  @Field(() => Date, { nullable: true })
  lastSyncAt?: Date | null;

  @Field(() => Int)
  memberCount!: number;
}

@InputType()
export class ConnectDirectoryAccountInput {
  @Field()
  workspaceId!: string;

  @Field(() => DirectoryProviderName)
  provider!: DirectoryProviderName;

  @Field(() => String, { nullable: true })
  redirectUri?: string | null;
}

@InputType()
export class CreateDirectorySyncScopeInput {
  @Field()
  directoryAccountId!: string;

  @Field()
  projectId!: string;

  @Field()
  scopeType!: string;

  @Field()
  externalId!: string;

  @Field(() => String, { nullable: true })
  label?: string | null;
}
