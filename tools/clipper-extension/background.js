/**
 * NotesGraph Web Clipper — background service worker.
 *
 * Flow: open the NotesGraph app's /clipper/import receiver in a background tab
 * and hand it a pending ClipperInput (title + link) via window.postMessage, so
 * the note exists at once. Meanwhile inject the extractor into the active tab
 * (the user's authenticated session) and capture title/text/images (fetched IN
 * the page so cookies/referer are the user's), then send that as the full
 * ClipperInput, which the app writes into the same note and stores the
 * attachments as blobs (ImportClipperService.fillClippedDoc).
 */

const DEFAULT_APP_BASE = 'https://app.notesgraph.com';

// Every step that waits on the page gets a deadline, so a stalled image host
// or a page that never answers fails the clip with a reason instead of
// leaving the popup on "Clipping…" forever.
const READ_PAGE_MS = 15_000;
const IMAGE_MS = 8_000;
const VIDEO_MS = 20_000;
// A whole video file can take a while on a slow connection.
const DOWNLOAD_MS = 120_000;
// Base64 makes it ~1.33x on its way to the app tab, and the workspace's file
// limit applies when it's stored, so stay well under both.
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function getAppBase() {
  try {
    const { appBaseUrl } = await chrome.storage.sync.get('appBaseUrl');
    return (appBaseUrl || DEFAULT_APP_BASE).replace(/\/+$/, '');
  } catch {
    return DEFAULT_APP_BASE;
  }
}

/**
 * Runs IN the active page (isolated world, after extract-clip.js injected the
 * `extractClip` global). Fetches each image with the page's credentials and
 * returns it as a data URL so the bytes survive the hop to the app. Images
 * load at once, each given `imageMs`; one that is slower is left out.
 */
async function captureInPage(imageMs) {
  /* global extractClip */
  const clip = extractClip();
  const toDataUrl = blob =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  const load = async url => {
    try {
      // The signal covers the body too, so a stream that stalls midway ends.
      const res = await fetch(url, {
        credentials: 'include',
        signal: AbortSignal.timeout(imageMs),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') || blob.size > 8_000_000) return null;
      return { url, mime: blob.type, dataUrl: await toDataUrl(blob) };
    } catch {
      return null; // unreachable or too slow: skip it
    }
  };
  const loaded = await Promise.all(clip.images.slice(0, 12).map(load));
  return { ...clip, imageData: loaded.filter(Boolean) };
}

/**
 * Runs IN the opened NotesGraph app tab: rebuild Blobs from the data URLs and
 * post the ClipperInput to the /clipper/import page (same-window postMessage,
 * which the app already listens for). The page's listener only exists once its
 * lazily loaded route has run, well after the tab says it's complete, so this
 * keeps sending until the import reports success or 20s pass. The page keeps
 * the first copy it gets; later ones only replace the port it answers on.
 */
function deliverToApp(payload) {
  const decode = b64 => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  };
  const attachments = {};
  for (const [key, dataUrl] of Object.entries(payload.attachmentsData || {})) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const mime =
      (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    attachments[key] = new Blob([decode(dataUrl.slice(comma + 1))], {
      type: mime,
    });
  }
  // Large attachments arrived earlier in pieces (stashAttachmentPart).
  const stash = globalThis.__ngClipParts || {};
  for (const key of payload.partedKeys || []) {
    const entry = stash[key];
    if (!entry) continue;
    attachments[key] = new Blob(entry.parts.map(decode), { type: entry.mime });
    delete stash[key];
  }
  const clipperInput = {
    title: payload.title,
    contentMarkdown: payload.contentMarkdown,
    contentHtml: payload.contentHtml || '',
    sourceUrl: payload.sourceUrl,
    attachments,
    workspace: payload.workspace,
    pending: !!payload.pending,
  };
  // Resolves true once the page answers, false if it hasn't in 20s.
  return new Promise(resolve => {
    let done = false;
    const started = Date.now();
    const send = () => {
      if (done) return;
      if (Date.now() - started > 20_000) {
        resolve(false);
        return;
      }
      // A port can be transferred only once, so each send gets its own.
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        done = true;
        resolve(true);
      };
      window.postMessage(
        { type: 'notesgraph-clipper:import', payload: clipperInput },
        '*',
        [channel.port2]
      );
      setTimeout(send, 500);
    };
    send();
  });
}

/**
 * Assemble any MSE video captured by mse-hook.js. The hook records per-frame in
 * the MAIN world, so query every frame and take the largest result.
 */
async function assembleCapturedVideo(tabId) {
  try {
    // Past the deadline the clip goes ahead without the video.
    const frames = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: async () =>
          typeof window.__ngAssembleCapturedVideo === 'function'
            ? await window.__ngAssembleCapturedVideo()
            : null,
      }),
      VIDEO_MS,
      'video capture timed out'
    );
    let best = null;
    for (const f of frames) {
      const r = f && f.result;
      if (r && r.dataUrl && (!best || r.dataUrl.length > best.dataUrl.length)) {
        best = r;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Read a response body into bytes, giving up past `maxBytes` (a size the
 * server announced, or the bytes read so far). Null when it isn't a video.
 */
async function readVideoBody(res, maxBytes) {
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (type && !/^video\/|^application\/octet-stream$/i.test(type)) return null;
  const announced = Number(res.headers.get('content-length') || 0);
  if (announced > maxBytes) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return {
    bytes,
    mime: type && type !== 'application/octet-stream' ? type : 'video/mp4',
  };
}

function bytesToDataUrl(bytes, mime) {
  // btoa per slice; a multiple of 3 so the pieces join without padding.
  const SLICE = 3 * 8 * 1024;
  let b64 = '';
  for (let i = 0; i < bytes.length; i += SLICE) {
    b64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE)));
  }
  return `data:${mime};base64,${b64}`;
}

/**
 * Runs IN the clipped page: fetch the video with the page's cookies and
 * referer, for a host that refuses the extension's own request.
 */
async function fetchVideoInPage(url, maxBytes, timeoutMs) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (type && !/^video\/|^application\/octet-stream$/i.test(type))
      return null;
    if (Number(res.headers.get('content-length') || 0) > maxBytes) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > maxBytes) return null;
    const mime =
      type && type !== 'application/octet-stream' ? type : 'video/mp4';
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () =>
        resolve({
          dataUrl: String(fr.result).replace(/^data:[^;,]*/, `data:${mime}`),
          mime,
          size: blob.size,
        });
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Download the page's own video file (see video-source.js): the whole video
 * with its audio, whether or not it was played. Null when the page has no
 * file to download or none came through, so the caller can fall back to the
 * recorded playback.
 */
async function downloadPageVideo(tabId) {
  let sources = [];
  try {
    const [{ result }] = await withTimeout(
      chrome.scripting
        .executeScript({ target: { tabId }, files: ['video-source.js'] })
        .then(() =>
          chrome.scripting.executeScript({
            target: { tabId },
            func: () => findVideoSources(), // eslint-disable-line no-undef
          })
        ),
      READ_PAGE_MS,
      'finding the video timed out'
    );
    sources = Array.isArray(result) ? result : [];
  } catch {
    return null;
  }
  const deadline = Date.now() + DOWNLOAD_MS;
  for (const source of sources) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    // The extension's own request first: no CORS, and the bytes stay here.
    try {
      const res = await fetch(source.url, {
        credentials: 'include',
        signal: AbortSignal.timeout(left),
      });
      const body = await readVideoBody(res, MAX_VIDEO_BYTES);
      if (body) {
        return {
          ext: /webm/.test(body.mime) ? 'webm' : 'mp4',
          mime: body.mime,
          hasAudio: true,
          downloaded: true,
          dataUrl: bytesToDataUrl(body.bytes, body.mime),
        };
      }
    } catch {
      /* refused or too slow: try from the page */
    }
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: fetchVideoInPage,
        args: [
          source.url,
          MAX_VIDEO_BYTES,
          Math.max(1000, deadline - Date.now()),
        ],
      });
      if (result && result.dataUrl) {
        return {
          ext: /webm/.test(result.mime) ? 'webm' : 'mp4',
          mime: result.mime,
          hasAudio: true,
          downloaded: true,
          dataUrl: result.dataUrl,
        };
      }
    } catch {
      /* next source */
    }
  }
  return null;
}

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function buildMarkdown(clip, imageKeys, videoKey, video) {
  const parts = [`# ${clip.title || clip.siteName || 'Clipped page'}`, ''];
  parts.push(`[Original](${clip.url})`, '');
  // Captured video: the app turns non-image attachments into an attachment
  // block (openable/plays), so we DON'T image-ref it here (that'd be a broken
  // thumbnail). Just leave a note; the blob rides in attachments.
  if (videoKey && video) {
    if (video.downloaded) {
      parts.push('> 📹 Video downloaded — attached below.', '');
    } else {
      const audioNote = video.hasAudio ? ' (with audio)' : ' (video only)';
      parts.push(
        `> 📹 Recorded the played part of the video${audioNote} — attached below.`,
        ''
      );
    }
  }
  for (const key of imageKeys) parts.push(`![](${key})`, '');
  // Direct-src (non-MSE) videos we can only link to.
  for (const v of clip.videos || []) parts.push(`Video: ${v}`, '');
  if (clip.text) parts.push(clip.text);
  return parts.join('\n');
}

// One call's arguments stay well under Chrome's message size limit. A
// multiple of 4, so each piece of base64 decodes on its own.
const PART_CHARS = 16 * 1024 * 1024;

/** Runs IN the app tab: keep one piece of a large attachment for later. */
function stashAttachmentPart(key, mime, part, first) {
  const store = (globalThis.__ngClipParts = globalThis.__ngClipParts || {});
  if (first || !store[key]) store[key] = { mime, parts: [] };
  store[key].parts.push(part);
}

async function sendToAppTab(tabId, payload) {
  // A video can be far larger than one message, so large attachments go
  // ahead in pieces and deliverToApp joins them.
  const attachmentsData = {};
  const partedKeys = [];
  for (const [key, dataUrl] of Object.entries(payload.attachmentsData || {})) {
    if (dataUrl.length <= PART_CHARS) {
      attachmentsData[key] = dataUrl;
      continue;
    }
    const comma = dataUrl.indexOf(',');
    const mime =
      (dataUrl.slice(0, comma).match(/data:([^;]+)/) || [])[1] ||
      'application/octet-stream';
    const b64 = dataUrl.slice(comma + 1);
    for (let i = 0; i < b64.length; i += PART_CHARS) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: stashAttachmentPart,
        args: [key, mime, b64.slice(i, i + PART_CHARS), i === 0],
      });
    }
    partedKeys.push(key);
  }
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: deliverToApp,
    args: [{ ...payload, attachmentsData, partedKeys }],
  });
  return !!(r && r.result);
}

/**
 * Starts a clip and returns as soon as the NotesGraph tab is open, so the
 * popup isn't held while the page is read. The note is made first from the
 * tab's title and link; the text, images and video follow when they're read.
 */
async function clipActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || /^(chrome|edge|about):/.test(tab.url || '')) {
    throw new Error('This page cannot be clipped.');
  }
  const appBase = await getAppBase();
  // Opened behind the current tab, so reading the page isn't interrupted.
  const appTab = await chrome.tabs.create({
    url: `${appBase}/clipper/import`,
    active: false,
  });
  void finishClip(tab, appTab.id).catch(console.error);
  return { started: true };
}

async function finishClip(tab, appTabId) {
  const title = tab.title || 'Clipped page';
  const noteCreated = waitForTabComplete(appTabId).then(() =>
    sendToAppTab(appTabId, {
      pending: true,
      title,
      contentMarkdown: `# ${title}\n\n[Original](${tab.url})\n\n_Clipping the page…_`,
      sourceUrl: tab.url,
      workspace: 'last-open-workspace',
    })
  );
  const content = readClip(tab).catch(err => ({
    title,
    contentMarkdown: `# ${title}\n\n[Original](${tab.url})\n\nCouldn't clip the page: ${
      err && err.message ? err.message : err
    }`,
    sourceUrl: tab.url,
    workspace: 'last-open-workspace',
  }));
  if (!(await noteCreated)) {
    // Not signed in, or no workspace to pick by itself: show the tab so the
    // user can finish there. The content is sent to it all the same.
    await chrome.tabs.update(appTabId, { active: true });
  }
  await sendToAppTab(appTabId, await content);
}

/** Reads the page's text, images and any captured video into a payload. */
async function readClip(tab) {
  const [{ result: clip }] = await withTimeout(
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['extract-clip.js'] })
      .then(() =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: captureInPage,
          args: [IMAGE_MS],
        })
      ),
    READ_PAGE_MS,
    "The page didn't respond. Reload it and try again."
  );

  const attachmentsData = {};
  const imageKeys = [];
  clip.imageData.forEach((img, i) => {
    const ext = (img.mime.split('/')[1] || 'jpg').split('+')[0];
    const key = `image-${i}.${ext}`;
    attachmentsData[key] = img.dataUrl;
    imageKeys.push(key);
  });

  // The page's own video file when it has one (the whole video, with audio);
  // otherwise the captured playback (LinkedIn/Facebook), with audio when the
  // element was recorded via captureStream; webm (recorder) or mp4 (segment
  // fallback).
  let videoKey = null;
  const video =
    (await downloadPageVideo(tab.id)) || (await assembleCapturedVideo(tab.id));
  if (video && video.dataUrl) {
    videoKey = `video-0.${video.ext || 'webm'}`;
    attachmentsData[videoKey] = video.dataUrl;
  }

  return {
    title: clip.title || clip.siteName || 'Clipped page',
    contentMarkdown: buildMarkdown(clip, imageKeys, videoKey, video),
    contentHtml: '',
    attachmentsData,
    videos: clip.videos,
    // Kept on the note as where the clip came from.
    sourceUrl: clip.url,
    workspace: 'last-open-workspace',
  };
}

chrome.commands.onCommand.addListener(command => {
  if (command === 'clip-page') void clipActiveTab().catch(console.error);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'clip-active-tab') {
    clipActiveTab().then(
      r => sendResponse({ ok: true, ...r }),
      e =>
        sendResponse({
          ok: false,
          error: String(e && e.message ? e.message : e),
        })
    );
    return true; // async response
  }
  return undefined;
});
