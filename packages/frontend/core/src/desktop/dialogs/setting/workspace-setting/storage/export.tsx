import { ExportIcon } from '@blocksuite/icons/rc';
import { notify } from '@notesgraph/component';
import { SettingRow } from '@notesgraph/component/setting-components';
import { Button } from '@notesgraph/component/ui/button';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import type { Workspace } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { universalId } from '@notesgraph/nbstore';
import track from '@notesgraph/track';
import { useState } from 'react';

interface ExportPanelProps {
  workspace: Workspace;
}

export const DesktopExportPanel = ({ workspace }: ExportPanelProps) => {
  const t = useI18n();
  const [saving, setSaving] = useState(false);
  const desktopApi = useService(DesktopApiService);
  const isLocalWorkspace = workspace.flavour === 'local';

  const [fullSyncing, setFullSyncing] = useState(false);
  const [fullSynced, setFullSynced] = useState(isLocalWorkspace);

  const fullSync = useAsyncCallback(async () => {
    setFullSyncing(true);
    await workspace.engine.blob.fullDownload();
    await workspace.engine.doc.waitForSynced();
    setFullSynced(true);
    setFullSyncing(false);
  }, [workspace.engine.blob, workspace.engine.doc]);

  const onExport = useAsyncCallback(async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      track.$.settingsPanel.workspace.export({
        type: 'workspace',
      });

      const result = await desktopApi.handler?.dialog.saveDBFileAs(
        universalId({
          peer: workspace.flavour,
          type: 'workspace',
          id: workspace.id,
        }),
        workspace.name$.getValue() ?? 'db'
      );
      if (result?.error) {
        throw new Error(result.error);
      } else if (!result?.canceled) {
        notify.success({ title: t['Export success']() });
      }
    } catch (e: any) {
      notify.error({ title: t['Export failed'](), message: e.message });
    } finally {
      setSaving(false);
    }
  }, [desktopApi, saving, t, workspace]);

  if (fullSynced) {
    return (
      <SettingRow
        name={t['Full Backup']()}
        desc={t['Full Backup Description']()}
      >
        <Button
          variant="primary"
          data-testid="export-notesgraph-backup"
          onClick={onExport}
          disabled={saving}
        >
          {t['Full Backup']()}
        </Button>
      </SettingRow>
    );
  }

  return (
    <>
      <SettingRow
        name={t['Full Backup']()}
        desc={
          fullSynced ? t['Full Backup Description']() : t['Full Backup Hint']()
        }
      >
        <Button
          variant="primary"
          data-testid="export-notesgraph-full-sync"
          onClick={fullSync}
          loading={fullSyncing}
          disabled={fullSyncing}
          prefix={<ExportIcon />}
        >
          {t['Full Backup']()}
        </Button>
      </SettingRow>
      <SettingRow
        name={t['Quick Export']()}
        desc={t['Quick Export Description']()}
      >
        <Button
          data-testid="export-notesgraph-backup"
          onClick={onExport}
          disabled={saving}
        >
          {t['Quick Export']()}
        </Button>
      </SettingRow>
    </>
  );
};
