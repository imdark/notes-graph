# NotesGraph Web Clipper (in-repo)

A Manifest V3 Chrome/Edge extension that clips the current page — its title,
readable text and images — into NotesGraph. It runs in **your own logged-in
browser session**, so it captures content on sites a server crawler can't reach
(LinkedIn, Facebook, paywalled pages).

## How it works

1. `extract-clip.js` reads the live DOM (title, `<article>/<main>` text, og +
   in-page images, direct `<video>` sources). Injected as a plain content
   script — no page-CSP exceptions needed.
2. `background.js` fetches each image **in the page** (so your cookies/referer
   apply), turns them into data URLs, builds a markdown body that references
   them, then opens the app's **`/import-clipper`** page and posts a
   `ClipperInput { title, contentMarkdown, contentHtml, attachments }` to it via
   `window.postMessage`.
3. The app (`ImportClipperService` + `MarkdownTransformer.importMarkdownWithAssets`)
   stores the attachments as **workspace blobs** and creates the doc — so the
   clipped images are archived and survive the original being deleted.

This reuses the existing `/import-clipper` receiver; nothing else in the app
needs to change.

## Load it (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `tools/clipper-extension` folder.
3. (Optional) Extension **Settings** → set the app URL (default
   `https://app.notesgraph.com`; use `http://localhost:8080` for local dev).
4. Open any page → click the toolbar icon → **Clip this page** (or `Ctrl/⌘+Shift+Y`).
   A NotesGraph tab opens and imports it into your last workspace.

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
audio in a *separate* buffer from video. `mse-hook.js` (MAIN world,
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
