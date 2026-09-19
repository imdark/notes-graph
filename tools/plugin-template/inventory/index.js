/**
 * Machine Inventory — the /api/inventory device list as a settings page.
 *
 * Plain ESM with no build step, like the other bundled plugins. It imports
 * React by bare specifier: the host's import map resolves that to
 * /plugin-runtime/react.js, which forwards the host's own instance, so the
 * hooks below run against the same dispatcher the host renderer installed. A
 * plugin that bundled its own React would throw the moment this page mounted.
 *
 * `createElement` rather than JSX so there is nothing to compile.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react';

const STATE_LABELS = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  unknown: 'Never checked',
};

const STATE_COLORS = {
  online: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
  unknown: '#9ca3af',
};

const relativeTime = atSeconds => {
  const secs = Math.round(Date.now() / 1000 - atSeconds);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

/** The line under a device's name: where it is, then how it is. */
const deviceMeta = device => {
  const parts = [];
  if (device.kind === 'folder') {
    if (device.path) parts.push(device.path);
    if (device.parentKey) parts.push(`on ${device.parentKey}`);
    if (device.repo) parts.push(`${device.repo}#${device.branch}`);
  } else {
    const target = [device.user, device.host].filter(Boolean).join('@');
    if (target) {
      parts.push(device.port === 22 ? target : `${target}:${device.port}`);
    }
  }
  parts.push(STATE_LABELS[device.state] ?? device.state);
  if (device.checkedAt) parts.push(`checked ${relativeTime(device.checkedAt)}`);
  if (device.version) parts.push(device.version);
  return parts.join(' · ');
};

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  desc: { fontSize: 12, opacity: 0.7, lineHeight: 1.5 },
  group: { fontSize: 13, fontWeight: 600, marginBottom: 6 },
  list: {
    border: '1px solid rgba(128,128,128,0.25)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderBottom: '1px solid rgba(128,128,128,0.18)',
  },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  name: { fontSize: 13, fontWeight: 500 },
  meta: { fontSize: 11, opacity: 0.65 },
  badge: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 4,
    background: 'rgba(128,128,128,0.18)',
  },
  empty: { padding: '18px 12px', fontSize: 13, opacity: 0.65, textAlign: 'center' },
  notice: { padding: 14, fontSize: 13, opacity: 0.8, lineHeight: 1.6 },
  button: {
    fontSize: 12,
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  danger: { color: '#ef4444', borderColor: 'rgba(239,68,68,0.45)' },
  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    padding: 12,
    border: '1px solid rgba(128,128,128,0.25)',
    borderRadius: 8,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, opacity: 0.7 },
  input: {
    fontSize: 12,
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
  },
  formError: { fontSize: 11, color: '#ef4444', gridColumn: '1 / -1' },
  formActions: {
    gridColumn: '1 / -1',
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
};

/** The server's key alphabet (InventoryService.normalizeKey). */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function AddDeviceForm({ onCancel, onSubmit, machines }) {
  const [form, setForm] = useState({
    key: '',
    name: '',
    kind: 'machine',
    host: '',
    user: '',
    port: '22',
    path: '',
    parentKey: '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const isFolder = form.kind === 'folder';

  const field = (label, key, placeholder) =>
    h(
      'div',
      { style: styles.field, key },
      h('label', { style: styles.label }, label),
      h('input', {
        style: styles.input,
        value: form[key],
        placeholder: placeholder || '',
        onChange: e => set(key, e.target.value),
      })
    );

  const submit = () => {
    const key = form.key.trim();
    if (!KEY_PATTERN.test(key)) {
      setError(
        'Key is required: letters, digits, dot, dash, underscore or colon (max 128).'
      );
      return;
    }
    const port = Number.parseInt(form.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be between 1 and 65535.');
      return;
    }
    if (isFolder && !form.path.trim()) {
      setError('A folder needs a path.');
      return;
    }
    setSaving(true);
    setError(null);
    onSubmit({
      key,
      name: form.name.trim() || key,
      kind: form.kind,
      host: form.host.trim(),
      user: form.user.trim(),
      port,
      path: isFolder ? form.path.trim() : null,
      parentKey: isFolder ? form.parentKey.trim() || null : null,
    })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  return h(
    'div',
    { style: styles.form },
    field('Key', 'key', 'build-box-01'),
    h(
      'div',
      { style: styles.field },
      h('label', { style: styles.label }, 'Kind'),
      h(
        'select',
        {
          style: styles.input,
          value: form.kind,
          onChange: e => set('kind', e.target.value),
        },
        h('option', { value: 'machine' }, 'Machine'),
        h('option', { value: 'folder' }, 'Folder')
      )
    ),
    field('Name', 'name', form.key || 'Build box'),
    isFolder ? field('Path', 'path', '/opt/notesgraph') : null,
    isFolder
      ? h(
          'div',
          { style: styles.field },
          h('label', { style: styles.label }, 'Machine'),
          h(
            'select',
            {
              style: styles.input,
              value: form.parentKey,
              onChange: e => set('parentKey', e.target.value),
            },
            h('option', { value: '' }, 'No machine'),
            machines.map(m =>
              h('option', { key: m.key, value: m.key }, m.name || m.key)
            )
          )
        )
      : null,
    isFolder ? null : field('Host', 'host', '10.0.0.4'),
    isFolder ? null : field('User', 'user', 'ubuntu'),
    isFolder ? null : field('Port', 'port', '22'),
    error ? h('div', { style: styles.formError }, error) : null,
    h(
      'div',
      { style: styles.formActions },
      h('button', { style: styles.button, onClick: onCancel }, 'Cancel'),
      h(
        'button',
        { style: styles.button, onClick: submit, disabled: saving },
        saving ? 'Saving…' : 'Register'
      )
    )
  );
}

function DeviceList({ title, devices, emptyText, onRemove }) {
  return h(
    'div',
    null,
    h('div', { style: styles.group }, title),
    h(
      'div',
      { style: styles.list },
      devices.length === 0
        ? h('div', { style: styles.empty }, emptyText)
        : devices.map((device, i) =>
            h(
              'div',
              {
                key: device.id,
                style:
                  i === devices.length - 1
                    ? { ...styles.row, borderBottom: 'none' }
                    : styles.row,
              },
              h('span', {
                style: {
                  ...styles.dot,
                  background: STATE_COLORS[device.state] ?? STATE_COLORS.unknown,
                },
              }),
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(
                  'div',
                  { style: styles.name },
                  device.name || device.key,
                  device.agentTarget
                    ? h(
                        'span',
                        { style: { ...styles.badge, marginLeft: 6 } },
                        'agent target'
                      )
                    : null
                ),
                h('div', { style: styles.meta }, deviceMeta(device))
              ),
              h(RemoveButton, { device, onRemove })
            )
          )
    )
  );
}

/**
 * Two-step rather than a window.confirm: a native dialog in a settings pane
 * is jarring, and this keeps the confirmation next to the row it affects.
 */
function RemoveButton({ device, onRemove }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!armed) {
    return h(
      'button',
      { style: styles.button, onClick: () => setArmed(true) },
      'Remove'
    );
  }
  return h(
    'span',
    { style: { display: 'flex', gap: 6 } },
    h(
      'button',
      { style: styles.button, onClick: () => setArmed(false) },
      'Cancel'
    ),
    h(
      'button',
      {
        style: { ...styles.button, ...styles.danger },
        disabled: busy,
        onClick: () => {
          setBusy(true);
          onRemove(device).finally(() => {
            setBusy(false);
            setArmed(false);
          });
        },
      },
      busy ? 'Removing…' : 'Confirm'
    )
  );
}

function createDevicesPage(ctx) {
  return function DevicesPage() {
    const [devices, setDevices] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [adding, setAdding] = useState(false);

    const load = useCallback(() => {
      setLoading(true);
      setError(null);
      ctx.workspace
        .getCurrent()
        .then(workspace => {
          if (!workspace) {
            throw new Error('Open a workspace to see its devices.');
          }
          return ctx.net.fetch(
            `/api/inventory/workspaces/${encodeURIComponent(workspace.id)}/devices`,
            { cache: 'no-store' }
          );
        })
        .then(async res => {
          // The API 404s on every route when the server has the inventory
          // plugin switched off, which is a configuration state rather than a
          // failure — worth saying plainly instead of "request failed".
          if (res.status === 404) {
            throw new Error(
              'The inventory API is not enabled on this server (inventory.enabled).'
            );
          }
          if (!res.ok) {
            throw new Error(`Could not load devices (${res.status}).`);
          }
          const body = await res.json();
          setDevices(body.devices ?? []);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : String(err));
          setDevices([]);
        })
        .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);

    // Writes need Workspace.Settings.Update server-side, so a viewer gets a
    // 403 here — surfaced rather than swallowed.
    const writeUrl = async suffix => {
      const workspace = await ctx.workspace.getCurrent();
      if (!workspace) throw new Error('Open a workspace first.');
      return `/api/inventory/workspaces/${encodeURIComponent(workspace.id)}/devices${suffix}`;
    };

    const register = useCallback(async input => {
      const res = await ctx.net.fetch(await writeUrl(''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body && (body.message || body.error)) ||
            `Could not register the device (${res.status}).`
        );
      }
      setAdding(false);
      load();
    }, [load]);

    const remove = useCallback(
      async device => {
        const res = await ctx.net.fetch(
          await writeUrl(`/${encodeURIComponent(device.key)}`),
          { method: 'DELETE' }
        );
        if (!res.ok && res.status !== 404) {
          setError(`Could not remove ${device.key} (${res.status}).`);
          return;
        }
        load();
      },
      [load]
    );

    const machines = (devices ?? []).filter(d => d.kind !== 'folder');
    const folders = (devices ?? []).filter(d => d.kind === 'folder');

    return h(
      'div',
      { style: styles.page },
      h(
        'div',
        { style: styles.desc },
        'Machines and folders registered as deployment and agent-execution targets. ',
        'The wf CLI writes here too — health comes from its check runs.'
      ),
      error
        ? h(
            'div',
            { style: { ...styles.list, ...styles.notice } },
            error,
            h(
              'div',
              { style: { marginTop: 10 } },
              h('button', { style: styles.button, onClick: load }, 'Try again')
            )
          )
        : null,
      devices === null
        ? h('div', { style: styles.notice }, loading ? 'Loading devices…' : '')
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
            adding
              ? h(AddDeviceForm, {
                  machines,
                  onCancel: () => setAdding(false),
                  onSubmit: register,
                })
              : null,
            h(DeviceList, {
              title: 'Machines',
              devices: machines,
              emptyText: 'No machines registered yet.',
              onRemove: remove,
            }),
            h(DeviceList, {
              title: 'Folders',
              devices: folders,
              emptyText: 'No folders registered yet.',
              onRemove: remove,
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h(
                'button',
                { style: styles.button, onClick: load, disabled: loading },
                loading ? 'Refreshing…' : 'Refresh'
              ),
              adding
                ? null
                : h(
                    'button',
                    { style: styles.button, onClick: () => setAdding(true) },
                    'Add device'
                  )
            )
          )
    );
  };
}

export default {
  activate(ctx) {
    ctx.ui.addSettingsPage({
      id: 'devices',
      title: 'Machine Inventory',
      component: createDevicesPage(ctx),
    });

    ctx.ui.addCommand({
      id: 'inventory-summary',
      label: 'Inventory: summarise devices',
      run: async () => {
        try {
          const workspace = await ctx.workspace.getCurrent();
          if (!workspace) {
            ctx.ui.notify({ title: 'Open a workspace first', theme: 'warning' });
            return;
          }
          const res = await ctx.net.fetch(
            `/api/inventory/workspaces/${encodeURIComponent(workspace.id)}/devices`,
            { cache: 'no-store' }
          );
          if (!res.ok) {
            ctx.ui.notify({
              title: 'Inventory unavailable',
              message:
                res.status === 404
                  ? 'The inventory API is not enabled on this server.'
                  : `Request failed (${res.status}).`,
              theme: 'error',
            });
            return;
          }
          const { devices = [] } = await res.json();
          const online = devices.filter(d => d.state === 'online').length;
          ctx.ui.notify({
            title: `${devices.length} device${devices.length === 1 ? '' : 's'}`,
            message: `${online} online · ${devices.length - online} not online`,
            theme: 'info',
          });
        } catch (err) {
          ctx.ui.notify({
            title: 'Inventory lookup failed',
            message: String(err),
            theme: 'error',
          });
        }
      },
    });
  },
};
