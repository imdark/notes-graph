import {
  DeleteIcon,
  LocalWorkspaceIcon,
  MoreVerticalIcon,
} from '@blocksuite/icons/rc';
import {
  IconButton,
  Loading,
  Menu,
  MenuItem,
  notify,
  Skeleton,
  useConfirmModal,
} from '@notesgraph/component';
import {
  Pagination,
  SettingHeader,
} from '@notesgraph/component/setting-components';
import { Avatar } from '@notesgraph/component/ui/avatar';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { BackupService } from '@notesgraph/core/modules/backup/services';
import { toArrayBuffer } from '@notesgraph/core/utils/array-buffer';
import { i18nTime, useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import bytes from 'bytes';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './styles.css';

const Empty = () => {
  const t = useI18n();
  return (
    <div className={styles.empty}>
      {t['com.notesgraph.settings.workspace.backup.empty']()}
    </div>
  );
};

const BlobAvatar = ({
  blob,
  name,
}: {
  blob: Uint8Array | null;
  name: string;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(new Blob([toArrayBuffer(blob)]));
    setUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return (
    <Avatar colorfulFallback name={name} rounded={4} size={32} url={url} />
  );
};

type BackupWorkspaceItem = {
  id: string;
  name: string;
  fileSize: number;
  updatedAt: Date;
  avatar: Uint8Array | null;
  dbPath: string;
};

const BackupWorkspaceItem = ({ item }: { item: BackupWorkspaceItem }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const { openConfirmModal } = useConfirmModal();
  const backupService = useService(BackupService);
  const t = useI18n();
  const [importing, setImporting] = useState(false);

  const { jumpToPage } = useNavigateHelper();

  const handleImport = useAsyncCallback(async () => {
    setImporting(true);
    track.$.settingsPanel.archivedWorkspaces.recoverArchivedWorkspace();
    const workspaceId = await backupService.recoverBackupWorkspace(item.id);
    if (!workspaceId) {
      setImporting(false);
      return;
    }
    notify.success({
      title: t['com.notesgraph.settings.workspace.backup.import.success'](),
      actions: [
        {
          key: 'open',
          label:
            t[
              'com.notesgraph.settings.workspace.backup.import.success.action'
            ](),
          onClick: () => {
            jumpToPage(workspaceId, 'all');
          },
          autoClose: false,
        },
      ],
    });
    setMenuOpen(false);
    setImporting(false);
  }, [backupService, item.id, jumpToPage, t]);

  const handleDelete = useCallback(
    (backupWorkspaceId: string) => {
      openConfirmModal({
        title: t['com.notesgraph.workspaceDelete.title'](),
        children:
          t['com.notesgraph.settings.workspace.backup.delete.warning'](),
        onConfirm: async () => {
          track.$.settingsPanel.archivedWorkspaces.deleteArchivedWorkspace();
          await backupService.deleteBackupWorkspace(backupWorkspaceId);
          notify.success({
            title:
              t['com.notesgraph.settings.workspace.backup.delete.success'](),
          });
        },
        confirmText: t['Confirm'](),
        cancelText: t['Cancel'](),
        confirmButtonOptions: {
          variant: 'error',
        },
      });
    },
    [backupService, openConfirmModal, t]
  );

  return (
    <div
      data-testid="backup-workspace-item"
      className={styles.listItem}
      key={item.id}
      onClick={() => setMenuOpen(v => !v)}
    >
      <BlobAvatar blob={item.avatar} name={item.name} />
      <div className={styles.listItemLeftLabel}>
        <div className={styles.listItemLeftLabelTitle}>{item.name}</div>
        <div className={styles.listItemLeftLabelDesc}>
          {bytes(item.fileSize)}
        </div>
      </div>
      <div className={styles.listItemRightLabel}>
        {t['com.notesgraph.settings.workspace.backup.delete-at']({
          date: i18nTime(item.updatedAt, {
            absolute: {
              accuracy: 'day',
            },
          }),
          time: i18nTime(item.updatedAt, {
            absolute: {
              accuracy: 'minute',
              noDate: true,
              noYear: true,
            },
          }),
        })}
        <Menu
          rootOptions={{
            open: menuOpen && !importing,
            onOpenChange: setMenuOpen,
            modal: true,
          }}
          items={
            <>
              <MenuItem
                prefixIcon={<LocalWorkspaceIcon />}
                onClick={handleImport}
              >
                {t['com.notesgraph.settings.workspace.backup.import']()}
              </MenuItem>
              <MenuItem
                prefixIcon={<DeleteIcon />}
                onClick={() => handleDelete(item.id)}
                type="danger"
              >
                {t['Delete']()}
              </MenuItem>
            </>
          }
          contentOptions={{ align: 'end' }}
        >
          <IconButton disabled={importing} size="20">
            {importing ? <Loading /> : <MoreVerticalIcon />}
          </IconButton>
        </Menu>
      </div>
    </div>
  );
};

const PAGE_SIZE = 6;

export const BackupSettingPanel = () => {
  const t = useI18n();
  const backupService = useService(BackupService);

  useEffect(() => {
    backupService.revalidate();
  }, [backupService]);

  const isLoading = useLiveData(backupService.isLoading$);
  const backupWorkspaces = useLiveData(backupService.pageBackupWorkspaces$);

  const [pageNum, setPageNum] = useState(0);

  const innerElement = useMemo(() => {
    if (isLoading) {
      return (
        <Skeleton
          style={{ margin: '2px', width: 'calc(100% - 4px)' }}
          height={60}
          animation="wave"
        />
      );
    }
    if (!backupWorkspaces) {
      return null;
    }
    return (
      <>
        <div className={styles.list}>
          {backupWorkspaces.items
            .slice(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE)
            .map(item => (
              <BackupWorkspaceItem key={item.id} item={item} />
            ))}
        </div>
        {backupWorkspaces.items.length > PAGE_SIZE && (
          <div className={styles.pagination}>
            <Pagination
              totalCount={backupWorkspaces?.items.length ?? 0}
              countPerPage={PAGE_SIZE}
              pageNum={pageNum}
              onPageChange={(_, pageNum) => {
                setPageNum(pageNum);
              }}
            />
          </div>
        )}
      </>
    );
  }, [isLoading, backupWorkspaces, pageNum]);

  const isEmpty =
    (backupWorkspaces?.items.length === 0 || !backupWorkspaces) && !isLoading;

  return (
    <>
      <SettingHeader
        title={t['com.notesgraph.settings.workspace.backup']()}
        subtitle={t['com.notesgraph.settings.workspace.backup.subtitle']()}
        data-testid="backup-title"
      />
      {isEmpty ? (
        <Empty />
      ) : (
        <div className={styles.listContainer}>{innerElement}</div>
      )}
    </>
  );
};
