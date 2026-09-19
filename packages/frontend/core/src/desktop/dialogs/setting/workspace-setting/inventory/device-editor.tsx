import { Button, Input, Modal, Scrollable, Switch } from '@notesgraph/component';
import {
  DEVICE_KINDS,
  type InventoryDevice,
  type RegisterDeviceInput,
} from '@notesgraph/core/modules/inventory';
import { useCallback, useMemo, useState } from 'react';

import * as styles from './styles.css';

/**
 * The server's own key alphabet (`InventoryService.normalizeKey`). Checked
 * here too so a typo comes back as a line under the field rather than as a
 * 400 after the round trip.
 */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface DeviceEditorProps {
  /** Omitted when registering a new device. */
  device?: InventoryDevice;
  /** Machines already registered, offered as parents for a folder. */
  machines: InventoryDevice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: RegisterDeviceInput) => Promise<void>;
}

export const DeviceEditor = ({
  device,
  machines,
  open,
  onOpenChange,
  onSubmit,
}: DeviceEditorProps) => {
  const [key, setKey] = useState(device?.key ?? '');
  const [name, setName] = useState(device?.name ?? '');
  const [kind, setKind] = useState(device?.kind ?? 'machine');
  const [host, setHost] = useState(device?.host ?? '');
  const [user, setUser] = useState(device?.user ?? '');
  const [port, setPort] = useState(String(device?.port ?? 22));
  const [parentKey, setParentKey] = useState(device?.parentKey ?? '');
  const [path, setPath] = useState(device?.path ?? '');
  const [repo, setRepo] = useState(device?.repo ?? '');
  const [branch, setBranch] = useState(device?.branch ?? 'main');
  const [recipe, setRecipe] = useState(device?.recipe ?? 'generic');
  const [channel, setChannel] = useState(device?.channel ?? 'stable');
  const [agentTarget, setAgentTarget] = useState(device?.agentTarget ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isFolder = kind === 'folder';
  const isEdit = !!device;

  const keyError = useMemo(() => {
    const trimmed = key.trim();
    if (!trimmed) return 'A key is required.';
    if (!KEY_PATTERN.test(trimmed)) {
      return 'Letters, digits, dot, dash, underscore or colon only (max 128).';
    }
    return null;
  }, [key]);

  const portError = useMemo(() => {
    const parsed = Number.parseInt(port, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return 'Port must be between 1 and 65535.';
    }
    return null;
  }, [port]);

  const pathError = isFolder && !path.trim() ? 'A folder needs a path.' : null;

  const canSubmit = !keyError && !portError && !pathError && !submitting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    /**
     * Every field goes on the wire, not just the edited ones: registration is
     * an upsert that falls back to defaults for anything omitted, so a partial
     * body would quietly reset `recipe`, `branch` and friends.
     */
    const input: RegisterDeviceInput = {
      key: key.trim(),
      name: name.trim() || key.trim(),
      kind,
      host: host.trim(),
      user: user.trim(),
      port: Number.parseInt(port, 10),
      parentKey: isFolder ? parentKey.trim() || null : null,
      path: isFolder ? path.trim() : null,
      repo: repo.trim() || null,
      branch: branch.trim() || 'main',
      recipe: recipe.trim() || 'generic',
      channel: channel.trim() || 'stable',
      agentTarget,
      labels: device?.labels ?? {},
    };
    onSubmit(input)
      .then(() => onOpenChange(false))
      .catch(err => {
        setServerError(
          err instanceof Error ? err.message : 'Could not save this device.'
        );
      })
      .finally(() => setSubmitting(false));
  }, [
    agentTarget,
    branch,
    canSubmit,
    channel,
    device,
    host,
    isFolder,
    key,
    kind,
    name,
    onOpenChange,
    onSubmit,
    parentKey,
    path,
    port,
    recipe,
    repo,
    user,
  ]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit ${device?.name || device?.key}` : 'Register a device'}
      description={
        isEdit
          ? undefined
          : 'Machines and folders the deployment and agent tooling can target.'
      }
      width={560}
    >
      <div className={styles.editor}>
        {/* Radix's scrollbar, not the browser's — global.css turns native
            scrollbars off app-wide, so an overflow:auto div here would
            scroll with no visible bar. */}
        <Scrollable.Root type="auto" className={styles.editorScrollRoot}>
          <Scrollable.Viewport className={styles.editorBody}>
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Key</span>
                <Input
                  value={key}
                  onChange={setKey}
                  disabled={isEdit}
                  placeholder="build-box-01"
                  data-testid="device-editor-key"
                />
                <span className={keyError ? styles.errorText : styles.hint}>
                  {keyError ??
                    (isEdit
                      ? 'The key identifies this device and cannot change.'
                      : 'How the CLI refers to this device.')}
                </span>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>Kind</span>
                <select
                  className={styles.select}
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                  disabled={isEdit}
                  data-testid="device-editor-kind"
                >
                  {DEVICE_KINDS.map(k => (
                    <option key={k} value={k}>
                      {k === 'machine' ? 'Machine' : 'Folder'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Name</span>
              <Input
                value={name}
                onChange={setName}
                placeholder={key || 'Build box'}
                data-testid="device-editor-name"
              />
              <span className={styles.hint}>
                Shown in this list. Defaults to the key.
              </span>
            </div>

            {isFolder ? (
              <>
                <div className={styles.field}>
                  <span className={styles.label}>Machine</span>
                  <select
                    className={styles.select}
                    value={parentKey}
                    onChange={e => setParentKey(e.target.value)}
                    data-testid="device-editor-parent"
                  >
                    <option value="">No machine</option>
                    {machines.map(machine => (
                      <option key={machine.key} value={machine.key}>
                        {machine.name || machine.key}
                      </option>
                    ))}
                  </select>
                  <span className={styles.hint}>
                    The machine this folder lives on.
                  </span>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>Path</span>
                  <Input
                    value={path}
                    onChange={setPath}
                    placeholder="/opt/notesgraph"
                    data-testid="device-editor-path"
                  />
                  {pathError ? (
                    <span className={styles.errorText}>{pathError}</span>
                  ) : null}
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Repo</span>
                    <Input
                      value={repo}
                      onChange={setRepo}
                      placeholder="git@github.com:you/app.git"
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Branch</span>
                    <Input value={branch} onChange={setBranch} placeholder="main" />
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <span className={styles.label}>Host</span>
                  <Input
                    value={host}
                    onChange={setHost}
                    placeholder="10.0.0.4"
                    data-testid="device-editor-host"
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>User</span>
                  <Input value={user} onChange={setUser} placeholder="ubuntu" />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>Port</span>
                  <Input
                    value={port}
                    onChange={setPort}
                    placeholder="22"
                    data-testid="device-editor-port"
                  />
                  {portError ? (
                    <span className={styles.errorText}>{portError}</span>
                  ) : null}
                </div>
              </div>
            )}

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Recipe</span>
                <Input
                  value={recipe}
                  onChange={setRecipe}
                  placeholder="generic"
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Channel</span>
                <Input
                  value={channel}
                  onChange={setChannel}
                  placeholder="stable"
                />
              </div>
            </div>

            <div className={styles.switchRow}>
              <div className={styles.field}>
                <span className={styles.label}>Agent target</span>
                <span className={styles.hint}>
                  Agents may run work on this device.
                </span>
              </div>
              <Switch
                checked={agentTarget}
                onChange={setAgentTarget}
                data-testid="device-editor-agent-target"
              />
            </div>

            {serverError ? (
              <span className={styles.errorText}>{serverError}</span>
            ) : null}
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>

        <div className={styles.editorActions}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="device-editor-save"
          >
            {isEdit ? 'Save' : 'Register'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
