import { Button } from '@notesgraph/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import {
  FolderSyncService,
  isFolderSyncSupported,
} from '@notesgraph/core/modules/folder-sync';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './styles.css';

/**
 * Bind a local folder to this workspace and keep the two in step.
 *
 * The "Reconnect" path matters more than it looks: a directory handle survives
 * a reload but its permission does not, and the browser only re-grants inside
 * a user gesture. So on startup a perfectly valid binding can come back
 * unusable, and the only fix is a button for the user to press.
 */
export const WorkspaceSettingFolderSync = () => {
  const folderSync = useService(FolderSyncService);
  const status = useLiveData(folderSync.status$);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void folderSync.resume();
  }, [folderSync]);

  const handleBind = useCallback(() => {
    setBusy(true);
    folderSync
      .bind()
      .catch(() => {
        /* surfaced through status$ */
      })
      .finally(() => setBusy(false));
  }, [folderSync]);

  const handleUnbind = useCallback(() => {
    setBusy(true);
    folderSync
      .unbind()
      .catch(() => {
        /* surfaced through status$ */
      })
      .finally(() => setBusy(false));
  }, [folderSync]);

  if (!isFolderSyncSupported()) {
    return (
      <>
        <SettingHeader
          title="Folder sync"
          subtitle="Keep a folder of markdown files and your notes in step."
        />
        <SettingWrapper>
          <SettingRow
            name="Not available in this browser"
            desc="Folder sync uses the File System Access API, which today only Chromium browsers (Chrome, Edge, Arc, Brave) support. It is not available on mobile."
          />
        </SettingWrapper>
      </>
    );
  }

  return (
    <>
      <SettingHeader
        title="Folder sync"
        subtitle="Keep a folder of markdown files and your notes in step, both ways."
      />

      <SettingWrapper title="Bound folder">
        {status.state === 'unbound' || status.state === 'error' ? (
          <SettingRow
            name="No folder bound"
            desc="Pick a folder of markdown files. Each file becomes a note, and edits flow both ways while this tab is open."
          >
            <Button variant="primary" loading={busy} onClick={handleBind}>
              Choose folder
            </Button>
          </SettingRow>
        ) : (
          <SettingRow
            name={'folderName' in status ? status.folderName : 'Folder'}
            desc={describe(status)}
          >
            <Button loading={busy} onClick={handleUnbind}>
              Unbind
            </Button>
          </SettingRow>
        )}

        {status.state === 'needs-permission' && (
          <SettingRow
            name="Reconnect needed"
            desc="The browser drops folder permission when the tab reloads. Reconnect to resume syncing."
          >
            <Button variant="primary" loading={busy} onClick={handleBind}>
              Reconnect
            </Button>
          </SettingRow>
        )}

        {status.state === 'error' && (
          <div className={styles.error}>{status.message}</div>
        )}

        {status.state === 'watching' && status.conflicts > 0 && (
          <div className={styles.warning}>
            {status.conflicts} conflict{status.conflicts === 1 ? '' : 's'}{' '}
            resolved by keeping the file on disk. The note&apos;s version was
            saved beside it as a .conflict file — nothing was discarded.
          </div>
        )}
      </SettingWrapper>

      <SettingWrapper title="What syncs">
        <SettingRow
          name="Markdown only"
          desc="Only .md files sync. Edgeless drawings, block comments and note properties have no markdown form and will not survive a round trip, so notes that use them are best kept out of a bound folder."
        />
        <SettingRow
          name="Files are matched by id"
          desc="Each synced file carries its note id in frontmatter, so renaming or moving a file in Finder keeps it paired with the same note."
        />
        <SettingRow
          name="Deletes are not mirrored"
          desc="Deleting a file stops it syncing but keeps the note. Notes are never deleted because a file disappeared."
        />
      </SettingWrapper>
    </>
  );
};

function describe(status: { state: string } & Record<string, unknown>): string {
  switch (status.state) {
    case 'syncing':
      return String(status.progress ?? 'Syncing…');
    case 'watching':
      return `${status.fileCount} file${status.fileCount === 1 ? '' : 's'} synced · ${
        status.live
          ? 'watching for changes live'
          : 'checking for changes every few seconds'
      }`;
    case 'needs-permission':
      return 'Waiting for permission to be re-granted.';
    default:
      return '';
  }
}
