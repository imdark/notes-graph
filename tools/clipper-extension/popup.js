const btn = document.getElementById('clip');
const status = document.getElementById('status');

function setStatus(msg, cls) {
  status.textContent = msg;
  status.className = 'status' + (cls ? ' ' + cls : '');
}

// Longer than every step's own deadline in background.js; only reached if the
// background worker itself stops answering.
const CLIP_MS = 60_000;

btn.addEventListener('click', () => {
  btn.disabled = true;
  setStatus('Clipping…');
  let answered = false;
  const timer = setTimeout(() => {
    if (answered) return;
    answered = true;
    btn.disabled = false;
    setStatus("Clipping didn't finish. Reload the page and try again.", 'err');
  }, CLIP_MS);
  chrome.runtime.sendMessage({ type: 'clip-active-tab' }, res => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    btn.disabled = false;
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, 'err');
    } else if (res && res.ok) {
      const bits = `${res.images} image${res.images === 1 ? '' : 's'}${res.video ? ' + video' : ''}`;
      setStatus(
        `Sent to NotesGraph (${bits}). Finish in the opened tab.`,
        'ok'
      );
    } else {
      setStatus((res && res.error) || 'Failed to clip.', 'err');
    }
  });
});

document.getElementById('opts').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
