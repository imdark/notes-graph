import { Button, Input, notify, useConfirmModal } from '@notesgraph/component';
import { GraphQLService } from '@notesgraph/core/modules/cloud';
import { WorkspacePermissionService } from '@notesgraph/core/modules/permissions';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import {
  deleteWorkspaceSecretMutation,
  renameWorkspaceSecretMutation,
  setWorkspaceSecretMutation,
  workspaceSecretsQuery,
} from '@notesgraph/graphql';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './styles.css';

type Secret = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
};

// Same rule as the server: secret names double as environment variable names.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const ago = (iso: string) => {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

/**
 * Adds a secret, or edits one when `secret` is given. On an edit a blank
 * value keeps the stored one, since the stored value is never sent back.
 */
const SecretForm = ({
  secret,
  taken,
  onSave,
  onCancel,
}: {
  secret?: Secret;
  taken: (name: string) => boolean;
  onSave: (input: {
    name: string;
    value: string;
    description: string;
  }) => Promise<void>;
  onCancel: () => void;
}) => {
  const [name, setName] = useState(secret?.name ?? '');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState(secret?.description ?? '');
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const nameError = !trimmed
    ? null
    : !NAME_PATTERN.test(trimmed)
      ? 'Use letters, digits and underscores, not starting with a digit.'
      : trimmed !== secret?.name && taken(trimmed)
        ? `A secret named ${trimmed} already exists.`
        : null;
  const canSave = !!trimmed && !nameError && (!!secret || !!value) && !saving;

  const save = useCallback(() => {
    if (!canSave) return;
    setSaving(true);
    onSave({ name: trimmed, value, description: description.trim() })
      .catch(err => {
        notify.error({
          title: secret
            ? `Couldn't save ${secret.name}`
            : `Couldn't add ${trimmed}`,
          message: errorMessage(err),
        });
      })
      .finally(() => setSaving(false));
  }, [canSave, description, onSave, secret, trimmed, value]);

  return (
    <div className={styles.form} data-testid="secret-form">
      <label className={styles.field}>
        Name
        <Input
          value={name}
          onChange={setName}
          onEnter={save}
          placeholder="GITHUB_TOKEN"
          autoFocus={!secret}
          status={nameError ? 'error' : 'default'}
          data-testid="secret-name-input"
        />
        {nameError ? (
          <span className={styles.fieldError}>{nameError}</span>
        ) : null}
      </label>
      <label className={styles.field}>
        {secret ? 'New value (leave blank to keep the current one)' : 'Value'}
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={setValue}
          onEnter={save}
          autoFocus={!!secret}
          data-testid="secret-value-input"
        />
      </label>
      <label className={styles.field}>
        What it&apos;s for (optional)
        <Input
          value={description}
          onChange={setDescription}
          onEnter={save}
          placeholder="Pushes branches from agent runs"
          data-testid="secret-description-input"
        />
      </label>
      <div className={styles.formActions}>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={!canSave}
          loading={saving}
          data-testid="secret-save"
        >
          {secret ? 'Save' : 'Add secret'}
        </Button>
      </div>
    </div>
  );
};

/** The workspace's secrets: names and descriptions, never values. */
export const SecretsView = () => {
  const workspace = useService(WorkspaceService).workspace;
  const graphql = useService(GraphQLService);
  const permission = useService(WorkspacePermissionService).permission;
  const canEdit = useLiveData(permission.isOwnerOrAdmin$);
  const { openConfirmModal } = useConfirmModal();
  const isLocal = workspace.flavour === 'local';

  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 'new' for the add form, a secret's name while it is being edited.
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    permission.revalidate();
  }, [permission]);

  const load = useCallback(() => {
    setLoadError(null);
    graphql
      .gql({
        query: workspaceSecretsQuery,
        variables: { workspaceId: workspace.id },
      })
      .then(data => setSecrets(data.workspace.secrets))
      .catch(err => setLoadError(errorMessage(err)));
  }, [graphql, workspace.id]);

  useEffect(() => {
    if (!isLocal) load();
  }, [isLocal, load]);

  const taken = useCallback(
    (name: string) => !!secrets?.some(s => s.name === name),
    [secrets]
  );

  const save = useCallback(
    async (
      previous: Secret | undefined,
      input: { name: string; value: string; description: string }
    ) => {
      if (previous && previous.name !== input.name) {
        await graphql.gql({
          query: renameWorkspaceSecretMutation,
          variables: {
            workspaceId: workspace.id,
            name: previous.name,
            newName: input.name,
          },
        });
      }
      await graphql.gql({
        query: setWorkspaceSecretMutation,
        variables: {
          input: {
            workspaceId: workspace.id,
            name: input.name,
            value: input.value || null,
            description: input.description,
          },
        },
      });
      setEditing(null);
      load();
    },
    [graphql, load, workspace.id]
  );

  const remove = useCallback(
    (secret: Secret) => {
      openConfirmModal({
        title: `Delete ${secret.name}?`,
        description:
          'The value is gone for good. Anything that reads this secret stops getting it.',
        confirmText: 'Delete',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          try {
            await graphql.gql({
              query: deleteWorkspaceSecretMutation,
              variables: { workspaceId: workspace.id, name: secret.name },
            });
            load();
          } catch (err) {
            notify.error({
              title: `Couldn't delete ${secret.name}`,
              message: errorMessage(err),
            });
          }
        },
      });
    },
    [graphql, load, openConfirmModal, workspace.id]
  );

  if (isLocal) {
    return (
      <div className={styles.content}>
        <div className={styles.empty}>
          Secrets are kept on the server, so this workspace has none while it is
          local. Enable cloud for it in workspace settings to add some.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.content}>
      <p className={styles.intro}>
        API keys, tokens and passwords for this workspace. Values are encrypted
        on the server and never shown again after you save them, so keep a copy
        elsewhere if you&apos;ll need to read one.
        {canEdit === false
          ? ' Only workspace owners and admins can add or change them.'
          : null}
      </p>

      <div className={styles.toolbar}>
        <span className={styles.sectionTitle}>
          Secrets
          {secrets ? (
            <span className={styles.sectionCount}>{secrets.length}</span>
          ) : null}
        </span>
        {canEdit && editing !== 'new' ? (
          <Button
            variant="primary"
            onClick={() => setEditing('new')}
            data-testid="secret-add"
          >
            Add secret
          </Button>
        ) : null}
      </div>

      {editing === 'new' ? (
        <SecretForm
          taken={taken}
          onSave={input => save(undefined, input)}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {loadError ? (
        <div className={styles.empty}>
          Couldn&apos;t load the secrets: {loadError}{' '}
          <Button variant="plain" onClick={load}>
            Try again
          </Button>
        </div>
      ) : secrets === null ? (
        <div className={styles.empty}>Loading secrets…</div>
      ) : secrets.length === 0 ? (
        editing === 'new' ? null : (
          <div className={styles.empty}>
            No secrets yet.
            {canEdit
              ? ' Add one to keep a token or key with this workspace.'
              : null}
          </div>
        )
      ) : (
        <div className={styles.list} data-testid="secrets-list">
          {secrets.map(secret =>
            editing === secret.name ? (
              <SecretForm
                key={secret.id}
                secret={secret}
                taken={taken}
                onSave={input => save(secret, input)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div
                key={secret.id}
                className={styles.row}
                data-testid="secret-row"
              >
                <div className={styles.rowText}>
                  <span className={styles.name}>{secret.name}</span>
                  <span className={styles.meta}>
                    {secret.description ? `${secret.description} · ` : ''}
                    Updated {ago(secret.updatedAt)}
                  </span>
                </div>
                {canEdit ? (
                  <div className={styles.actions}>
                    <Button
                      variant="plain"
                      onClick={() => setEditing(secret.name)}
                    >
                      Edit
                    </Button>
                    <Button variant="plain" onClick={() => remove(secret)}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
