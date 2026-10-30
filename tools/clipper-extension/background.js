/**
 * NotesGraph Web Clipper — background service worker.
 *
 * Flow: inject the extractor into the active tab (the user's authenticated
 * session) → capture title/text/images (fetched IN the page so cookies/referer
 * are the user's) → open the NotesGraph app's /clipper/import receiver → hand
 * off a ClipperInput via window.postMessage. The app persists the attachments
 * as blobs (ImportClipperService + MarkdownTransformer.importMarkdownWithAssets).
 */

const DEFAULT_APP_BASE = 'https://app.notesgraph.com';

// Every step that waits on the page gets a deadline, so a stalled image host
// or a page that never answers fails the clip with a reason instead of
// leaving the popup on "Clipping…" forever.
const READ_PAGE_MS = 15_000;
const IMAGE_MS = 8_000;
const VIDEO_MS = 20_000;

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
  const attachments = {};
  for (const [key, dataUrl] of Object.entries(payload.attachmentsData || {})) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mime =
      (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    attachments[key] = new Blob([arr], { type: mime });
  }
  const clipperInput = {
    title: payload.title,
    contentMarkdown: payload.contentMarkdown,
    contentHtml: payload.contentHtml || '',
    sourceUrl: payload.sourceUrl,
    attachments,
    workspace: payload.workspace,
  };
  let done = false;
  const started = Date.now();
  const send = () => {
    if (done || Date.now() - started > 20_000) return;
    // A port can be transferred only once, so each send gets its own.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      done = true;
    };
    window.postMessage(
      { type: 'notesgraph-clipper:import', payload: clipperInput },
      '*',
      [channel.port2]
    );
    setTimeout(send, 500);
  };
  send();
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

function buildMarkdown(clip, imageKeys, videoKey, hasAudio) {
  const parts = [`# ${clip.title || clip.siteName || 'Clipped page'}`, ''];
  parts.push(`[Original](${clip.url})`, '');
  // Captured video: the app turns non-image attachments into an attachment
  // block (openable/plays), so we DON'T image-ref it here (that'd be a broken
  // thumbnail). Just leave a note; the blob rides in attachments.
  if (videoKey) {
    const audioNote = hasAudio ? ' (with audio)' : ' (video only)';
    parts.push(`> 📹 Captured video${audioNote} — attached below.`, '');
  }
  for (const key of imageKeys) parts.push(`![](${key})`, '');
  // Direct-src (non-MSE) videos we can only link to.
  for (const v of clip.videos || []) parts.push(`Video: ${v}`, '');
  if (clip.text) parts.push(clip.text);
  return parts.join('\n');
}

async function clipActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || /^(chrome|edge|about):/.test(tab.url || '')) {
    throw new Error('This page cannot be clipped.');
  }

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

  // Captured streamed video (LinkedIn/Facebook), with audio when the element
  // was recorded via captureStream; webm (recorder) or mp4 (segment fallback).
  let videoKey = null;
  const video = await assembleCapturedVideo(tab.id);
  if (video && video.dataUrl) {
    videoKey = `video-0.${video.ext || 'webm'}`;
    attachmentsData[videoKey] = video.dataUrl;
  }

  const payload = {
    title: clip.title || clip.siteName || 'Clipped page',
    contentMarkdown: buildMarkdown(
      clip,
      imageKeys,
      videoKey,
      video && video.hasAudio
    ),
    contentHtml: '',
    attachmentsData,
    videos: clip.videos,
    // Kept on the note as where the clip came from.
    sourceUrl: clip.url,
    workspace: 'last-open-workspace',
  };

  const appBase = await getAppBase();
  const appTab = await chrome.tabs.create({ url: `${appBase}/clipper/import` });
  await waitForTabComplete(appTab.id);
  await chrome.scripting.executeScript({
    target: { tabId: appTab.id },
    func: deliverToApp,
    args: [payload],
  });
  return { images: imageKeys.length, video: !!videoKey };
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
