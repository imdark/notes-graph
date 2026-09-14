/**
 * NotesGraph Web Clipper — background service worker.
 *
 * Flow: inject the extractor into the active tab (the user's authenticated
 * session) → capture title/text/images (fetched IN the page so cookies/referer
 * are the user's) → open the NotesGraph app's /import-clipper receiver → hand
 * off a ClipperInput via window.postMessage. The app persists the attachments
 * as blobs (ImportClipperService + MarkdownTransformer.importMarkdownWithAssets).
 */

const DEFAULT_APP_BASE = 'https://app.notesgraph.com';
const MAX_CLIP_IMAGES = 12;
const MAX_IMAGE_BYTES = 8_000_000;

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
 * returns it as a data URL so the bytes survive the hop to the app.
 */
async function captureInPage() {
  /* global extractClip */
  const clip = extractClip();
  const toDataUrl = blob =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  const imageData = [];
  for (const url of clip.images.slice(0, 12)) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') || blob.size > 8_000_000) continue;
      imageData.push({ url, mime: blob.type, dataUrl: await toDataUrl(blob) });
    } catch {
      /* skip unreachable image */
    }
  }
  return { ...clip, imageData };
}

/**
 * Runs IN the opened NotesGraph app tab: rebuild Blobs from the data URLs and
 * post the ClipperInput to the /import-clipper page (same-window postMessage,
 * which the app already listens for). Retries a few times to beat SPA hydration.
 */
function deliverToApp(payload) {
  const attachments = {};
  for (const [key, dataUrl] of Object.entries(payload.attachmentsData || {})) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mime = (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    attachments[key] = new Blob([arr], { type: mime });
  }
  const clipperInput = {
    title: payload.title,
    contentMarkdown: payload.contentMarkdown,
    contentHtml: payload.contentHtml || '',
    attachments,
    workspace: payload.workspace,
  };
  let done = false;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    done = true;
  };
  const send = () => {
    if (done) return;
    window.postMessage(
      { type: 'notesgraph-clipper:import', payload: clipperInput },
      '*',
      [channel.port2]
    );
  };
  send();
  setTimeout(send, 600);
  setTimeout(send, 1500);
}

/**
 * Assemble any MSE video captured by mse-hook.js. The hook records per-frame in
 * the MAIN world, so query every frame and take the largest result.
 */
async function assembleCapturedVideo(tabId) {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: async () =>
        typeof window.__ngAssembleCapturedVideo === 'function'
          ? await window.__ngAssembleCapturedVideo()
          : null,
    });
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

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['extract-clip.js'],
  });
  const [{ result: clip }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: captureInPage,
  });

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
    workspace: 'last-open-workspace',
  };

  const appBase = await getAppBase();
  const appTab = await chrome.tabs.create({ url: `${appBase}/import-clipper` });
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
      e => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
    );
    return true; // async response
  }
  return undefined;
});
