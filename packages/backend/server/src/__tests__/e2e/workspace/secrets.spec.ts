import {
  deleteWorkspaceSecretMutation,
  renameWorkspaceSecretMutation,
  setWorkspaceSecretMutation,
  workspaceSecretsQuery,
} from '@notesgraph/graphql';

import { Mockers } from '../../mocks';
import { app, e2e } from '../test';

async function init() {
  const owner = await app.create(Mockers.User);
  const member = await app.create(Mockers.User);
  const workspace = await app.create(Mockers.Workspace, { owner });
  await app.create(Mockers.WorkspaceUser, {
    workspaceId: workspace.id,
    userId: member.id,
  });
  return { owner, member, workspace };
}

e2e('owner can add, list, rename and delete secrets', async t => {
  const { owner, workspace } = await init();
  await app.login(owner);

  const { setWorkspaceSecret } = await app.gql({
    query: setWorkspaceSecretMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        name: 'GH_TOKEN',
        value: 'ghp_secret',
        description: 'GitHub',
      },
    },
  });
  t.is(setWorkspaceSecret.name, 'GH_TOKEN');

  let list = await app.gql({
    query: workspaceSecretsQuery,
    variables: { workspaceId: workspace.id },
  });
  t.deepEqual(
    list.workspace.secrets.map(s => [s.name, s.description]),
    [['GH_TOKEN', 'GitHub']]
  );
  t.false(JSON.stringify(list).includes('ghp_secret'));

  await app.gql({
    query: renameWorkspaceSecretMutation,
    variables: { workspaceId: workspace.id, name: 'GH_TOKEN', newName: 'GH' },
  });
  const { deleteWorkspaceSecret } = await app.gql({
    query: deleteWorkspaceSecretMutation,
    variables: { workspaceId: workspace.id, name: 'GH' },
  });
  t.true(deleteWorkspaceSecret);

  list = await app.gql({
    query: workspaceSecretsQuery,
    variables: { workspaceId: workspace.id },
  });
  t.deepEqual(list.workspace.secrets, []);
});

e2e('rejects bad names and new secrets without a value', async t => {
  const { owner, workspace } = await init();
  await app.login(owner);

  await t.throwsAsync(
    app.gql({
      query: setWorkspaceSecretMutation,
      variables: {
        input: { workspaceId: workspace.id, name: '1-bad name', value: 'v' },
      },
    }),
    { message: /letters, digits and underscores/ }
  );
  await t.throwsAsync(
    app.gql({
      query: setWorkspaceSecretMutation,
      variables: { input: { workspaceId: workspace.id, name: 'EMPTY' } },
    }),
    { message: /needs a value/ }
  );
});

e2e('a plain member cannot change secrets', async t => {
  const { member, workspace } = await init();
  await app.login(member);

  await t.throwsAsync(
    app.gql({
      query: setWorkspaceSecretMutation,
      variables: {
        input: { workspaceId: workspace.id, name: 'KEY', value: 'v' },
      },
    })
  );
});
