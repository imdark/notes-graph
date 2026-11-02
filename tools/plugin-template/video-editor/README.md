# Video Editor — edit a video by conversation

The marketplace plugin for video-use inside NotesGraph. It is the **launch
surface**: it makes the project note, installs the Video editor agent, and
starts a run. The **engine** is the server's `video-editor` agent profile
(Claude Code with the [video-use](https://github.com/browser-use/video-use)
skill and ffmpeg) running on a device of yours — your Mac through
`wf agent serve`. Previews come back as **question attachments**, so you
approve or revise a cut from the phone's Agents page, with the video playing
inline. Design: `docs/reference/video-editor-agent.md`.

## What it contributes

- **Video editor: New project** — a note titled "Video: new project" with
  Footage, Brief, Edit log, Cuts and Deliverables sections. Put the path of
  the folder holding your clips (on the device that runs the agent) under
  Footage and say what the video is for under Brief.
- **Video editor: Install the agent** — installs the Video editor agent from
  its template into the workspace, once. It runs on the device picked in the
  panel, or the only / first non-cloud device registered.
- **Video editor: Edit this video** — starts the agent on the open note. It
  transcribes, asks shaped questions with options, proposes the strategy and
  waits, renders a 720p preview and asks "Approve / Revise / Try another take"
  with the preview attached, then renders the final and links it in the note.
- **Sidebar panel "Video editor"** (desktop and web) — device picker, the two
  actions, and the list of project notes with an Edit button each.

## How the pieces fit

```
plugin (this)  →  Video editor agent (template, model `video-editor`)
                  →  queued as a device job  →  `wf agent serve` on your Mac
                       transcribe (local, key-free) · cut · render (ffmpeg)
                       upload_artifact → ask_user(attachments) → your phone
```

## Try it (dev load)

```sh
cd tools/plugin-template/video-editor
npx http-server -p 5999 --cors
```

In NotesGraph open **Settings → Plugins**, paste `http://localhost:5999` into
"Load a dev plugin" and click **Load**. Bundled copies are seeded into the
marketplace by the plugin server on startup, so on a deployed server it is
already listed under Marketplace.

## Needs

- The `agents` plugin capability (SDK ≥ the version shipping this plugin).
- A device registered as an agent target with ffmpeg and the video-use
  checkout (`wf agent serve`; the profile's setup step installs the rest).

## Limitations

- The phone has no command palette or sidebar panels, so start runs from the
  web or desktop app. The run itself, its questions and previews are on the
  phone.
- The device picker only affects agents installed afterwards; change an
  installed agent's device in Settings → Agents.
- Footage must be a folder on the device that runs the agent (uploading
  clips from the phone is a later phase).
