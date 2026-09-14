import { Button, Loading, notify } from '@notesgraph/component';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import { DirectoryService } from '@notesgraph/core/modules/directory';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { UrlService } from '@notesgraph/core/modules/url';
import { DirectoryProviderType } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { buildWorkspaceSettingsRedirectUri } from '../../../../../../components/hooks/use-navigate-helper';
import { GOOGLE_WORKSPACE_INTEGRATION_SCROLL_ANCHOR } from '../../../navigation-constants';
import { IntegrationSettingHeader } from '../setting';
import * as styles from './setting-panel.css';

type AvailableGroup = { externalId: string; email: string; name?: string | null };
type AvailableOrgUnit = { externalId: string; path: string; name?: string | null };

export const GoogleWorkspaceSettingPanel = () => {
  const t = useI18n();
  const { directoryService, projectsService, urlService } = useServices({
    DirectoryService,
    ProjectsService,
    UrlService,
  });
  const account = useLiveData(directoryService.directory.account$);
  const isLoading = useLiveData(directoryService.directory.isLoading$);
  const projects = useLiveData(projectsService.projects.projects$);

  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [busyScopeId, setBusyScopeId] = useState<string | null>(null);
  const [addingScope, setAddingScope] = useState(false);
  const [scopeType, setScopeType] = useState<'group' | 'org_unit'>('group');
  const [groups, setGroups] = useState<AvailableGroup[]>([]);
  const [orgUnits, setOrgUnits] = useState<AvailableOrgUnit[]>([]);
  const [selectedExternalId, setSelectedExternalId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [creatingScope, setCreatingScope] = useState(false);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects ?? []) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const url = await directoryService.connectAccount(
        DirectoryProviderType.google,
        buildWorkspaceSettingsRedirectUri(window.location.href, {
          tab: 'workspace:integrations',
          scrollAnchor: GOOGLE_WORKSPACE_INTEGRATION_SCROLL_ANCHOR,
        })
      );
      urlService.openExternal(url);
    } catch (error) {
      console.error('Failed to connect Google Workspace', error);
      notify.error({
        title: t['com.notesgraph.integration.google-workspace.connect-error'](),
      });
    } finally {
      setConnecting(false);
    }
  }, [directoryService, t, urlService]);

  const handleDisconnect = useCallback(async () => {
    if (!account) return;
    setDisconnecting(true);
    try {
      await directoryService.disconnectAccount(account.id);
    } catch (error) {
      console.error('Failed to disconnect Google Workspace', error);
      notify.error({
        title: t['com.notesgraph.integration.google-workspace.disconnect-error'](),
      });
    } finally {
      setDisconnecting(false);
    }
  }, [account, directoryService, t]);

  const handleOpenAddScope = useCallback(() => {
    setAddingScope(true);
    setSelectedExternalId('');
    setLoadingOptions(true);
    Promise.all([
      directoryService.listAvailableGroups(),
      directoryService.listAvailableOrgUnits(),
    ])
      .then(([availableGroups, availableOrgUnits]) => {
        setGroups(availableGroups);
        setOrgUnits(availableOrgUnits);
      })
      .catch(error => {
        console.error('Failed to load Google Workspace groups/OUs', error);
        notify.error({
          title:
            t['com.notesgraph.integration.google-workspace.load-options-error'](),
        });
      })
      .finally(() => setLoadingOptions(false));
  }, [directoryService, t]);

  const handleCreateScope = useCallback(async () => {
    if (!account || !selectedExternalId || !selectedProjectId) return;
    setCreatingScope(true);
    try {
      const option =
        scopeType === 'group'
          ? groups.find(g => g.externalId === selectedExternalId)
          : orgUnits.find(o => o.externalId === selectedExternalId);
      await directoryService.createSyncScope({
        directoryAccountId: account.id,
        projectId: selectedProjectId,
        scopeType,
        externalId: selectedExternalId,
        label:
          scopeType === 'group'
            ? (option as AvailableGroup | undefined)?.email
            : (option as AvailableOrgUnit | undefined)?.path,
      });
      setAddingScope(false);
    } catch (error) {
      console.error('Failed to create directory sync scope', error);
      notify.error({
        title: t['com.notesgraph.integration.google-workspace.add-scope-error'](),
      });
    } finally {
      setCreatingScope(false);
    }
  }, [
    account,
    directoryService,
    groups,
    orgUnits,
    scopeType,
    selectedExternalId,
    selectedProjectId,
    t,
  ]);

  const handleRemoveScope = useCallback(
    async (scopeId: string) => {
      setBusyScopeId(scopeId);
      try {
        await directoryService.deleteSyncScope(scopeId);
      } catch (error) {
        console.error('Failed to remove directory sync scope', error);
        notify.error({
          title:
            t['com.notesgraph.integration.google-workspace.remove-scope-error'](),
        });
      } finally {
        setBusyScopeId(null);
      }
    },
    [directoryService, t]
  );

  const handleSyncNow = useCallback(
    async (scopeId: string) => {
      setBusyScopeId(scopeId);
      try {
        await directoryService.syncScopeNow(scopeId);
      } catch (error) {
        console.error('Failed to trigger directory sync', error);
        notify.error({
          title: t['com.notesgraph.integration.google-workspace.sync-error'](),
        });
      } finally {
        setBusyScopeId(null);
      }
    },
    [directoryService, t]
  );

  return (
    <>
      <IntegrationSettingHeader
        icon={<NotesGraphLogoIcon />}
        name={t['com.notesgraph.integration.google-workspace.name']()}
        desc={t['com.notesgraph.integration.google-workspace.desc']()}
        divider={false}
      />
      {isLoading && account === undefined ? (
        <Loading />
      ) : !account ? (
        <div className={styles.list}>
          <Button
            variant="primary"
            onClick={() => void handleConnect()}
            loading={connecting}
          >
            {t['com.notesgraph.integration.google-workspace.connect']()}
          </Button>
        </div>
      ) : (
        <div className={styles.list}>
          <section className={styles.group}>
            <div className={styles.groupHeader}>
              <div>
                <div className={styles.groupTitle}>{account.domain}</div>
                <div className={styles.groupCaption}>
                  {t[
                    `com.notesgraph.integration.google-workspace.status.${account.status === 'active' ? 'active' : 'inactive'}` as 'com.notesgraph.integration.google-workspace.status.active'
                  ]()}
                  {account.lastSyncAt
                    ? ` · ${new Date(account.lastSyncAt).toLocaleString()}`
                    : null}
                </div>
                {account.lastError ? (
                  <div className={styles.errorText}>{account.lastError}</div>
                ) : null}
              </div>
              <Button
                onClick={() => void handleDisconnect()}
                loading={disconnecting}
              >
                {t['com.notesgraph.integration.google-workspace.disconnect']()}
              </Button>
            </div>

            {account.syncScopes.length === 0 ? (
              <div className={styles.empty}>
                {t['com.notesgraph.integration.google-workspace.no-scopes']()}
              </div>
            ) : (
              account.syncScopes.map(scope => (
                <div key={scope.id} className={styles.scopeRow}>
                  <div className={styles.scopeInfo}>
                    <div className={styles.groupTitle}>
                      {scope.label ?? scope.externalId}
                    </div>
                    <div className={styles.groupCaption}>
                      {projectNameById.get(scope.projectId) ?? scope.projectId}
                      {' · '}
                      {scope.memberCount}{' '}
                      {t['com.notesgraph.integration.google-workspace.members']()}
                    </div>
                    {scope.lastError ? (
                      <div className={styles.errorText}>{scope.lastError}</div>
                    ) : null}
                  </div>
                  <div className={styles.scopeActions}>
                    <Button
                      onClick={() => void handleSyncNow(scope.id)}
                      loading={busyScopeId === scope.id}
                    >
                      {t['com.notesgraph.integration.google-workspace.sync-now']()}
                    </Button>
                    <Button
                      onClick={() => void handleRemoveScope(scope.id)}
                      loading={busyScopeId === scope.id}
                    >
                      {t['com.notesgraph.integration.google-workspace.remove-scope']()}
                    </Button>
                  </div>
                </div>
              ))
            )}

            {addingScope ? (
              <div className={styles.form}>
                <div className={styles.formRow}>
                  <select
                    className={styles.select}
                    value={scopeType}
                    onChange={e => {
                      setScopeType(e.target.value as 'group' | 'org_unit');
                      setSelectedExternalId('');
                    }}
                  >
                    <option value="group">
                      {t['com.notesgraph.integration.google-workspace.scope-type.group']()}
                    </option>
                    <option value="org_unit">
                      {t['com.notesgraph.integration.google-workspace.scope-type.org-unit']()}
                    </option>
                  </select>
                  <select
                    className={styles.select}
                    value={selectedExternalId}
                    onChange={e => setSelectedExternalId(e.target.value)}
                    disabled={loadingOptions}
                  >
                    <option value="">
                      {t['com.notesgraph.integration.google-workspace.select-source']()}
                    </option>
                    {(scopeType === 'group' ? groups : orgUnits).map(option => (
                      <option key={option.externalId} value={option.externalId}>
                        {'email' in option ? option.email : option.path}
                      </option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                  >
                    <option value="">
                      {t['com.notesgraph.integration.google-workspace.select-project']()}
                    </option>
                    {(projects ?? []).map(project => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.actions}>
                  <Button onClick={() => setAddingScope(false)}>
                    {t['com.notesgraph.confirmModal.button.cancel']()}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void handleCreateScope()}
                    disabled={!selectedExternalId || !selectedProjectId}
                    loading={creatingScope}
                  >
                    {t['com.notesgraph.integration.google-workspace.add-scope']()}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.actions}>
                <Button onClick={handleOpenAddScope}>
                  {t['com.notesgraph.integration.google-workspace.add-scope']()}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
};
