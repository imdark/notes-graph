import { ComputerPanelIcon, FolderIcon, MoreHorizontalIcon } from '@blocksuite/icons/rc';
import {
  Button,
  Menu,
  MenuItem,
  useConfirmModal,
} from '@notesgraph/component';
import { SettingHeader } from '@notesgraph/component/setting-components';
import { useWorkspaceInfo } from '@notesgraph/core/components/hooks/use-workspace-info';
import {
  type InventoryDevice,
  InventoryService,
  type RegisterDeviceInput,
} from '@notesgraph/core/modules/inventory';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { FrameworkScope, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DeviceEditor } from './device-editor';
import * as styles from './styles.css';

const relativeTime = (atSeconds: number) => {
  const secs = Math.round(Date.now() / 1000 - atSeconds);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

const STATE_LABELS: Record<string, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  unknown: 'Never checked',
};

/**
 * The line under a device's name. A machine is identified by where you would
 * ssh to it; a folder by where it sits and what it tracks.
 */
const deviceMeta = (device: InventoryDevice) => {
  const parts: string[] = [];

  if (device.kind === 'folder') {
    if (device.path) parts.push(device.path);
    if (device.parentKey) parts.push(`on ${device.parentKey}`);
    if (device.repo) parts.push(`${device.repo}#${device.branch}`);
  } else {
    const target = [device.user, device.host].filter(Boolean).join('@');
    if (target) parts.push(device.port === 22 ? target : `${target}:${device.port}`);
    if (device.recipe && device.recipe !== 'generic') parts.push(device.recipe);
  }

  parts.push(STATE_LABELS[device.state] ?? device.state);
  if (device.checkedAt) parts.push(`checked ${relativeTime(device.checkedAt)}`);
  if (device.version) parts.push(device.version);

  return parts.join(' · ');
};

const DeviceList = ({
  title,
  desc,
  devices,
  emptyText,
  onEdit,
  onRemove,
}: {
  title: string;
  desc: string;
  devices: InventoryDevice[];
  emptyText: string;
  onEdit: (device: InventoryDevice) => void;
  onRemove: (device: InventoryDevice) => void;
}) => (
  <div>
    <div className={styles.groupTitle}>{title}</div>
    <div className={styles.groupDesc}>{desc}</div>
    <div className={styles.list} style={{ marginTop: 10 }}>
      {devices.length === 0 ? (
        <div className={styles.empty}>{emptyText}</div>
      ) : (
        devices.map(device => (
          <div key={device.id} className={styles.row} data-testid="device-row">
            <span className={styles.rowIcon}>
              {device.kind === 'folder' ? <FolderIcon /> : <ComputerPanelIcon />}
            </span>
            <div className={styles.rowText}>
              <span className={styles.rowName}>
                <span
                  className={styles.stateDot}
                  data-state={device.state}
                  aria-hidden="true"
                />
                <span className={styles.rowNameText}>
                  {device.name || device.key}
                </span>
                {device.agentTarget ? (
                  <span className={styles.badge}>agent target</span>
                ) : null}
                {device.channel && device.channel !== 'stable' ? (
                  <span className={styles.badge}>{device.channel}</span>
                ) : null}
              </span>
              <span className={styles.rowMeta}>{deviceMeta(device)}</span>
            </div>
            <div className={styles.rowActions}>
              <Menu
                items={
                  <>
                    <MenuItem onClick={() => onEdit(device)}>Edit</MenuItem>
                    <MenuItem type="danger" onClick={() => onRemove(device)}>
                      Remove
                    </MenuItem>
                  </>
                }
              >
                <Button
                  variant="plain"
                  prefix={<MoreHorizontalIcon />}
                  data-testid="device-row-more"
                />
              </Menu>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

const WorkspaceSettingInventoryMain = () => {
  const inventoryService = useService(InventoryService);
  const devicesEntity = inventoryService.devices;

  const devices = useLiveData(devicesEntity.devices$);
  const isLoading = useLiveData(devicesEntity.isLoading$);
  const error = useLiveData(devicesEntity.error$);
  const disabled = useLiveData(devicesEntity.disabled$);
  const unsupported = useLiveData(devicesEntity.unsupported$);

  const { openConfirmModal } = useConfirmModal();
  const [editing, setEditing] = useState<InventoryDevice | undefined>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    devicesEntity.revalidate();
  }, [devicesEntity]);

  const machines = useMemo(
    () => (devices ?? []).filter(device => device.kind !== 'folder'),
    [devices]
  );
  const folders = useMemo(
    () => (devices ?? []).filter(device => device.kind === 'folder'),
    [devices]
  );

  const handleSave = useCallback(
    async (input: RegisterDeviceInput) => {
      await devicesEntity.register(input);
    },
    [devicesEntity]
  );

  const handleRemove = useCallback(
    (device: InventoryDevice) => {
      openConfirmModal({
        title: `Remove "${device.name || device.key}"?`,
        description:
          'It disappears from the inventory. The machine or folder itself is untouched, and re-registering brings it back.',
        confirmText: 'Remove',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: () => devicesEntity.remove(device.key),
      });
    },
    [devicesEntity, openConfirmModal]
  );

  if (unsupported) {
    return (
      <div className={styles.notice}>
        <span>
          This workspace is local, so there is no server holding an inventory.
          Enable cloud sync for this workspace to register devices.
        </span>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className={styles.notice}>
        <span>
          The inventory API is switched off on this server. An admin can turn it
          on by setting <span className={styles.code}>inventory.enabled</span> in
          the server config.
        </span>
        <Button onClick={() => devicesEntity.revalidate()}>Check again</Button>
      </div>
    );
  }

  // Only a first load has nothing to show; a refresh keeps the list up.
  if (devices === undefined) {
    return (
      <div className={styles.notice}>
        <span>{isLoading ? 'Loading devices…' : 'No devices loaded yet.'}</span>
        {error ? (
          <>
            <span className={styles.errorText}>
              {error instanceof Error ? error.message : String(error)}
            </span>
            <Button onClick={() => devicesEntity.revalidate()}>Try again</Button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.main}>
      <div className={styles.listHeader}>
        <div className={styles.groupDesc}>
          Machines and folders registered as deployment and agent-execution
          targets. The <span className={styles.code}>wf</span> CLI writes here
          too — health comes from its check runs.
        </div>
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          data-testid="new-device"
        >
          Add device
        </Button>
      </div>

      {error ? (
        <div className={styles.notice}>
          <span className={styles.errorText}>
            Could not refresh the inventory:{' '}
            {error instanceof Error ? error.message : String(error)}
          </span>
          <Button onClick={() => devicesEntity.revalidate()}>Try again</Button>
        </div>
      ) : null}

      <DeviceList
        title="Machines"
        desc="Hosts the tooling can reach over ssh."
        devices={machines}
        emptyText="No machines registered yet."
        onEdit={setEditing}
        onRemove={handleRemove}
      />

      <DeviceList
        title="Folders"
        desc="Checkouts and deployment directories living on those machines."
        devices={folders}
        emptyText="No folders registered yet."
        onEdit={setEditing}
        onRemove={handleRemove}
      />

      {creating ? (
        <DeviceEditor
          machines={machines}
          open
          onOpenChange={open => !open && setCreating(false)}
          onSubmit={handleSave}
        />
      ) : null}

      {editing ? (
        <DeviceEditor
          // Remount per device so the form's initial state follows the row.
          key={editing.id}
          device={editing}
          machines={machines}
          open
          onOpenChange={open => !open && setEditing(undefined)}
          onSubmit={handleSave}
        />
      ) : null}
    </div>
  );
};

export const WorkspaceSettingInventory = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workspaceInfo = useWorkspaceInfo(workspace);

  if (workspace === null) {
    return null;
  }

  return (
    <FrameworkScope scope={workspace.scope}>
      <SettingHeader
        title="Devices"
        subtitle={`Deployment and agent targets in ${
          workspaceInfo?.name || 'this workspace'
        }`}
      />
      <WorkspaceSettingInventoryMain />
    </FrameworkScope>
  );
};
