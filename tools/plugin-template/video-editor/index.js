/**
 * Video Editor — the launch surface for video-use inside NotesGraph.
 *
 * The plugin makes the project note, installs the "Video editor" agent (the
 * server's `video-editor` profile: Claude Code with the video-use skill and
 * ffmpeg on a device of yours) and starts a run on a note. Everything after
 * that happens in the run: the agent transcribes the footage, asks about the
 * cut, and sends previews back as questions you answer on your phone.
 *
 * Plain ESM with no build step, like the other bundled plugins. React comes
 * from the host through the import map (see registry/index.js), so it is
 * `createElement`, not JSX.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react';

const TEMPLATE_ID = 'video-editor';
const MODEL = 'video-editor';
const DEVICE_KEY = 'deviceKey';
const PROJECT_PREFIX = 'Video:';

/** The sections a project note starts with; the agent reads and writes them. */
const PROJECT_SECTIONS = [
  { type: 'h2', text: 'Footage' },
  {
    text: '/path/to/folder/on/your/Mac — replace with the folder holding the clips',
  },
  { type: 'h2', text: 'Brief' },
  { text: "What this video is for, who it's for, how long, the tone." },
  { type: 'h2', text: 'Edit log' },
  { type: 'h2', text: 'Cuts' },
  { type: 'h2', text: 'Deliverables' },
];

const message = err => (err instanceof Error ? err.message : String(err));

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 14, padding: 12 },
  desc: { fontSize: 12, opacity: 0.7, lineHeight: 1.5 },
  group: { fontSize: 13, fontWeight: 600, marginBottom: 6 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, opacity: 0.7 },
  select: {
    fontSize: 12,
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
  },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  button: {
    fontSize: 12,
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  list: {
    border: '1px solid rgba(128,128,128,0.25)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderBottom: '1px solid rgba(128,128,128,0.18)',
  },
  name: {
    fontSize: 13,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: '14px 12px',
    fontSize: 12,
    opacity: 0.65,
    textAlign: 'center',
  },
  note: { fontSize: 11, opacity: 0.6, lineHeight: 1.5 },
};

export default {
  activate(ctx) {
    const { ui, docs, agents, storage } = ctx;

    const fail = (title, err) =>
      ui.notify({ title, message: message(err), theme: 'error' });

    /** The device new agents run on: chosen in the panel, else a sensible one. */
    const pickDevice = async () => {
      const stored = await storage.get(DEVICE_KEY);
      if (stored) return { key: stored, chosen: true };
      const devices = await agents.listDevices();
      if (devices.length === 0) return { key: undefined, chosen: false };
      const pick =
        devices.length === 1
          ? devices[0]
          : (devices.find(d => d.key !== 'cloud') ?? devices[0]);
      return { key: pick.key, name: pick.name, chosen: false };
    };

    /** The Video editor agent in this workspace, installed from its template if missing. */
    const ensureAgent = async () => {
      const existing = (await agents.list()).find(a => a.model === MODEL);
      if (existing) return { agent: existing, installed: false };
      const device = await pickDevice();
      const agent = await agents.installTemplate(TEMPLATE_ID, {
        deviceKey: device.key,
      });
      if (device.key && !device.chosen) {
        ui.notify({
          title: `Video editor runs on ${device.name ?? device.key}`,
          message:
            'Picked for you; choose another device in the Video editor panel before installing again.',
          theme: 'info',
        });
      }
      return { agent, installed: true };
    };

    const newProject = async () => {
      try {
        const doc = await docs.create({ title: 'Video: new project' });
        const blocks = await docs.getBlocks(doc.id);
        const note = blocks.find(b => b.flavour === 'notesgraph:note');
        for (const section of PROJECT_SECTIONS) {
          await docs.insertBlock(doc.id, {
            flavour: 'notesgraph:paragraph',
            props: section.type
              ? { type: section.type, text: section.text }
              : { text: section.text },
            ...(note ? { parent: note.id } : {}),
          });
        }
        ui.notify({
          title: `Created "${doc.title}"`,
          message:
            'Open it from All docs, put the footage folder path under Footage and write the Brief, then run "Video editor: Edit this video" on it.',
          theme: 'success',
        });
        return doc;
      } catch (err) {
        fail('Could not create the project note', err);
        return null;
      }
    };

    const installAgent = async () => {
      try {
        const { agent, installed } = await ensureAgent();
        ui.notify({
          title: installed
            ? `Installed "${agent.name}"`
            : `"${agent.name}" is already installed`,
          message: agent.deviceKey
            ? `Runs on device ${agent.deviceKey}.`
            : 'No device chosen yet: pick one in Settings → Agents.',
          theme: 'success',
        });
        return agent;
      } catch (err) {
        fail('Could not install the Video editor agent', err);
        return null;
      }
    };

    const editDoc = async docId => {
      try {
        const { agent } = await ensureAgent();
        await agents.start(agent.id, { kind: 'doc', docId });
        ui.notify({
          title: 'Run started',
          message:
            "The strategy question and previews come to your phone's Agents page.",
          theme: 'success',
        });
      } catch (err) {
        fail('Could not start the edit', err);
      }
    };

    const editCurrent = async () => {
      let doc = null;
      try {
        doc = await docs.getCurrent();
      } catch (err) {
        fail('Could not read the open note', err);
        return;
      }
      if (!doc) {
        ui.notify({
          title: 'Open a project note first',
          message:
            'Run "Video editor: New project" to make one, open it, then run this again.',
          theme: 'warning',
        });
        return;
      }
      await editDoc(doc.id);
    };

    ui.addCommand({
      id: 'video-editor:new-project',
      label: 'Video editor: New project',
      run: newProject,
    });
    ui.addCommand({
      id: 'video-editor:install-agent',
      label: 'Video editor: Install the agent',
      run: installAgent,
    });
    ui.addCommand({
      id: 'video-editor:edit-current',
      label: 'Video editor: Edit this video',
      run: editCurrent,
    });

    ui.addSidebarPanel({
      id: 'video-editor',
      title: 'Video editor',
      component: function VideoEditorPanel() {
        const [devices, setDevices] = useState([]);
        const [deviceKey, setDeviceKey] = useState('');
        const [projects, setProjects] = useState([]);
        const [busy, setBusy] = useState(false);

        const refresh = useCallback(async () => {
          try {
            const [list, stored, all] = await Promise.all([
              agents.listDevices(),
              storage.get(DEVICE_KEY),
              docs.list(),
            ]);
            setDevices(list);
            setDeviceKey(stored ?? '');
            const mine = all.filter(d =>
              (d.title ?? '').trim().startsWith(PROJECT_PREFIX)
            );
            mine.sort(
              (a, b) =>
                (b.updatedDate ?? b.createDate ?? 0) -
                (a.updatedDate ?? a.createDate ?? 0)
            );
            setProjects(mine);
          } catch (err) {
            fail('Video editor panel could not load', err);
          }
        }, []);

        useEffect(() => {
          void refresh();
        }, [refresh]);

        const run = useCallback(
          async fn => {
            setBusy(true);
            try {
              await fn();
            } finally {
              setBusy(false);
              void refresh();
            }
          },
          [refresh]
        );

        const chooseDevice = async e => {
          const key = e.target.value;
          setDeviceKey(key);
          try {
            if (key) await storage.set(DEVICE_KEY, key);
            else await storage.delete(DEVICE_KEY);
          } catch (err) {
            fail('Could not save the device', err);
          }
        };

        return h(
          'div',
          { style: styles.page },
          h(
            'div',
            { style: styles.desc },
            'Make a project note, point it at a folder of footage on your Mac, ' +
              'and start an edit. The agent asks about the cut and sends ' +
              'previews to your phone.'
          ),
          h(
            'div',
            { style: styles.field },
            h('label', { style: styles.label }, 'Runs on'),
            h(
              'select',
              {
                style: styles.select,
                value: deviceKey,
                onChange: chooseDevice,
              },
              h('option', { value: '' }, 'Pick a device when installing'),
              ...devices.map(d =>
                h('option', { key: d.key, value: d.key }, d.name || d.key)
              )
            ),
            h(
              'div',
              { style: styles.note },
              'Changing this only affects agents installed afterwards; an ' +
                'installed agent keeps its device (Settings → Agents).'
            )
          ),
          h(
            'div',
            { style: styles.actions },
            h(
              'button',
              {
                style: styles.button,
                disabled: busy,
                onClick: () => run(newProject),
              },
              'New project'
            ),
            h(
              'button',
              {
                style: styles.button,
                disabled: busy,
                onClick: () => run(editCurrent),
              },
              'Edit this video'
            )
          ),
          h(
            'div',
            null,
            h('div', { style: styles.group }, 'Projects'),
            h(
              'div',
              { style: styles.list },
              projects.length === 0
                ? h(
                    'div',
                    { style: styles.empty },
                    'No project notes yet (titles starting with "Video:").'
                  )
                : projects.map(p =>
                    h(
                      'div',
                      { style: styles.row, key: p.id },
                      h(
                        'span',
                        { style: styles.name, title: p.title },
                        p.title
                      ),
                      h(
                        'button',
                        {
                          style: styles.button,
                          disabled: busy,
                          onClick: () => run(() => editDoc(p.id)),
                        },
                        'Edit'
                      )
                    )
                  )
            )
          )
        );
      },
    });
  },
};
