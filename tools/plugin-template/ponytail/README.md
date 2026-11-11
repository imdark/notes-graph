# Ponytail — code reviews from a note

The marketplace plugin for [ponytail](https://github.com/DietrichGebert/ponytail)
(MIT) inside NotesGraph. Ponytail's skills are on the server's skill catalog
(pinned to v5.3.3), so any Claude Code agent can take them in the agent
editor:

- `ponytail`: write the smallest change that fully solves the task
- `ponytail-review`: plain-English review of a change, with numbered findings and a verdict
- `ponytail-audit`: the same kind of report for a whole repo
- `ponytail-debt`: a list of every deferred `shortcut:` comment

This plugin adds one command to that set.

## What it contributes

- **Ponytail: Review the change in this note**: installs the "Ponytail
  review" agent from its template if the workspace doesn't have it, then
  starts it on the open note. The note names the change: a PR link, a branch,
  a commit, or files. With none named, the agent reviews the last commit. A
  note asking for the whole repo gets an audit, and one asking what was
  deferred gets the debt ledger. The report is added to the note under
  "Ponytail review (date)". The agent changes no code.

The agent runs on your first registered device other than the cloud runner,
because a review needs a checkout of the repo. You can change the device in
Settings → Agents.

## Not included

Ponytail's hooks, its status band, the per-turn webhook, and `/ponytail-gain`
and `/ponytail-help` are left out. They're built for an interactive Claude Code
terminal, and agent runs here only load skills.

## Try it (dev load)

```sh
cd tools/plugin-template/ponytail
npx http-server -p 5999 --cors
```

In NotesGraph, open **Settings → Plugins**, paste `http://localhost:5999`
into "Load a dev plugin" and click **Load**. On a deployed server, the plugin
server seeds bundled copies into the marketplace when it starts.
