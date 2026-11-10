# NotesGraph Web Clipper (in-repo)

A Manifest V3 Chrome/Edge extension that clips the current page — its title,
readable text and images — into NotesGraph. It runs in **your own logged-in
browser session**, so it captures content on sites a server crawler can't reach
(LinkedIn, Facebook, paywalled pages).

## How it works

1. `background.js` opens the app's **`/clipper/import`** page in a background
   tab and posts it a pending `ClipperInput` (`pending: true`, the tab's title
   and link) via `window.postMessage`. The app creates the note from that
   straight away. The popup returns at this point; it doesn't wait for the page
   to be read.
2. Meanwhile `extract-clip.js` reads the live DOM (title, `<article>/<main>`
   text, og + in-page images, direct `<video>` sources). Injected as a plain
   content script — no page-CSP exceptions needed.
3. `background.js` fetches each image **in the page** (so your cookies/referer
   apply), turns them into data URLs, builds a markdown body that references
   them, and posts the full
   `ClipperInput { title, contentMarkdown, contentHtml, attachments }`.
4. The app (`ImportClipperService.fillClippedDoc`) replaces the note's body with
   it and stores the attachments as **workspace blobs**, so the clipped images
   are archived and survive the original being deleted. If reading the page
   fails, the note keeps its title and link plus the reason.

If the app can't create the note by itself (you're signed out, or there's no
last-used workspace), the tab is brought to the front so you can finish there.
The app must be deployed with `pending` support before this extension is used:
an older app would save the title-and-link note as the whole clip.

## Load it (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `tools/clipper-extension` folder.
3. (Optional) Extension **Settings** → set the app URL (default
   `https://app.notesgraph.com`; use `http://localhost:8080` for local dev).
4. Open any page → click the toolbar icon → **Clip this page** (or `Ctrl/⌘+Shift+Y`).
   A NotesGraph tab opens behind the current one and imports it into your last
   workspace.

You must be **signed in** to NotesGraph in that browser.

## Verify the extractor

`extract-clip.js` mirrors the unit-tested server extractor in
`packages/common/link-card/src/archive.ts`. A DOM smoke test:

```bash
node tools/clipper-extension/smoke-test.mjs
```

## Video capture (LinkedIn / Facebook)

LinkedIn/Facebook stream video via **MSE** (a `<video>` playing a `blob:` URL fed
JS-fetched HLS/DASH segments) — there's no file URL to download, and DASH streams
audio in a _separate_ buffer from video. `mse-hook.js` (MAIN world,
`document_start`, scoped to linkedin.com / facebook.com / fb.watch) captures it
two ways:

1. **Preferred — with audio.** When a `<video>` starts playing, it records that
   element's `captureStream()` with a `MediaRecorder`. That stream carries
   **both audio and video** tracks and the recorder muxes them into a single
   **WebM** — no ffmpeg needed. Realtime, so it captures what you've played.
2. **Fallback — video only.** If `captureStream`/`MediaRecorder` is blocked or
   the media is tainted, it keeps a copy of the appended MSE segments and
   concatenates the video buffer into an MP4 (no audio).

**To capture a video:** open the post and **let the video play through** before
clicking Clip. The result shows "+ video"; the note says "(with audio)" or
"(video only)".

**Honest limits:**

- The audio path is **realtime** — only the portion you actually played is
  recorded.
- Output is **WebM** (audio path) or MP4 (fallback); capped at ~80 MB.
- The stored blob is linked via `![](video-0.<ext>)`; rendering it as an inline
  **video player** (vs a thumbnail) is a small app-side follow-up — the bytes
  are archived regardless and downloadable from the note.
