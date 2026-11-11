/**
 * Ponytail — the launch surface for ponytail's review skills inside NotesGraph.
 *
 * One command: install the "Ponytail review" agent if the workspace lacks it
 * (Claude Code with /ponytail-review, /ponytail-audit, /ponytail-debt) and
 * start it on the open note, which names the PR, branch or commit to review.
 * The report lands back in that note. Plain ESM with no build step, like the
 * other bundled plugins.
 */
const TEMPLATE_ID = 'ponytail-review';

const message = err => (err instanceof Error ? err.message : String(err));

export default {
  activate(ctx) {
    const { ui, docs, agents } = ctx;

    const fail = (title, err) =>
      ui.notify({ title, message: message(err), theme: 'error' });

    /** A review needs the repo: prefer the user's own device over the cloud runner. */
    const pickDevice = async () => {
      const devices = await agents.listDevices();
      return devices.find(d => d.key !== 'cloud') ?? devices[0];
    };

    const reviewCurrent = async () => {
      let doc = null;
      try {
        doc = await docs.getCurrent();
      } catch (err) {
        fail('Could not read the open note', err);
        return;
      }
      if (!doc) {
        ui.notify({
          title: 'Open a note first',
          message:
            'Open the note that names the PR, branch or commit to review, then run this again.',
          theme: 'warning',
        });
        return;
      }
      try {
        const device = await pickDevice();
        // installTemplate hands back the agent already made from the template.
        const agent = await agents.installTemplate(TEMPLATE_ID, {
          deviceKey: device?.key,
        });
        await agents.start(agent.id, { kind: 'doc', docId: doc.id });
        ui.notify({
          title: 'Review started',
          message: agent.deviceKey
            ? `Runs on ${agent.deviceKey}; the report is added to "${doc.title}".`
            : 'No device chosen yet: pick one for "Ponytail review" in Settings → Agents.',
          theme: 'success',
        });
      } catch (err) {
        fail('Could not start the review', err);
      }
    };

    ui.addCommand({
      id: 'ponytail:review-current',
      label: 'Ponytail: Review the change in this note',
      run: reviewCurrent,
    });
  },
};
