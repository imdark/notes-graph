import { PrismaClient, User, Workspace } from '@prisma/client';
import ava, { TestFn } from 'ava';

import { UserModel } from '../../models/user';
import { WorkspaceModel } from '../../models/workspace';
import { WorkspaceSecretModel } from '../../models/workspace-secret';
import { createTestingModule, type TestingModule } from '../utils';

interface Context {
  module: TestingModule;
  db: PrismaClient;
  user: UserModel;
  workspace: WorkspaceModel;
  secrets: WorkspaceSecretModel;
}

const test = ava as TestFn<Context>;

test.before(async t => {
  const module = await createTestingModule();
  t.context.user = module.get(UserModel);
  t.context.workspace = module.get(WorkspaceModel);
  t.context.secrets = module.get(WorkspaceSecretModel);
  t.context.db = module.get(PrismaClient);
  t.context.module = module;
});

let user: User;
let workspace: Workspace;

test.beforeEach(async t => {
  await t.context.module.initTestingDB();
  user = await t.context.user.create({ email: 'test@notesgraph.com' });
  workspace = await t.context.workspace.create(user.id);
});

test.after(async t => {
  await t.context.module.close();
});

test('stores the value encrypted and never lists it', async t => {
  const { secrets, db } = t.context;
  const created = await secrets.upsert({
    workspaceId: workspace.id,
    name: 'GH_TOKEN',
    value: 'ghp_secret',
    description: 'GitHub for agent runs',
    userId: user.id,
  });

  t.is(created.name, 'GH_TOKEN');
  t.false('encryptedValue' in created);

  const row = await db.workspaceSecret.findFirstOrThrow({
    where: { workspaceId: workspace.id },
  });
  t.not(row.encryptedValue, 'ghp_secret');
  t.false(row.encryptedValue.includes('ghp_secret'));

  const listed = await secrets.list(workspace.id);
  t.deepEqual(
    listed.map(s => [s.name, s.description]),
    [['GH_TOKEN', 'GitHub for agent runs']]
  );
  t.false('encryptedValue' in listed[0]);

  t.is(await secrets.reveal(workspace.id, 'GH_TOKEN'), 'ghp_secret');
});

test('replaces the value, or only the description when no value is given', async t => {
  const { secrets } = t.context;
  await secrets.upsert({ workspaceId: workspace.id, name: 'KEY', value: 'a' });

  await secrets.upsert({ workspaceId: workspace.id, name: 'KEY', value: 'b' });
  t.is(await secrets.reveal(workspace.id, 'KEY'), 'b');

  await secrets.upsert({
    workspaceId: workspace.id,
    name: 'KEY',
    description: 'note',
  });
  t.is(await secrets.reveal(workspace.id, 'KEY'), 'b');
  t.is((await secrets.get(workspace.id, 'KEY'))?.description, 'note');
});

test('renames and deletes', async t => {
  const { secrets } = t.context;
  await secrets.upsert({ workspaceId: workspace.id, name: 'OLD', value: 'v' });

  await secrets.rename(workspace.id, 'OLD', 'NEW');
  t.is(await secrets.get(workspace.id, 'OLD'), null);
  t.is(await secrets.reveal(workspace.id, 'NEW'), 'v');

  t.true(await secrets.delete(workspace.id, 'NEW'));
  t.false(await secrets.delete(workspace.id, 'NEW'));
  t.deepEqual(await secrets.list(workspace.id), []);
});

test('keeps secrets per workspace', async t => {
  const { secrets } = t.context;
  const other = await t.context.workspace.create(user.id);
  await secrets.upsert({ workspaceId: workspace.id, name: 'K', value: '1' });
  await secrets.upsert({ workspaceId: other.id, name: 'K', value: '2' });

  t.is(await secrets.reveal(workspace.id, 'K'), '1');
  t.is(await secrets.reveal(other.id, 'K'), '2');
});
