const btn = document.getElementById('clip');
const status = document.getElementById('status');

function setStatus(msg, cls) {
  status.textContent = msg;
  status.className = 'status' + (cls ? ' ' + cls : '');
}

btn.addEventListener('click', () => {
  btn.disabled = true;
  setStatus('Clipping…');
  chrome.runtime.sendMessage({ type: 'clip-active-tab' }, res => {
    btn.disabled = false;
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, 'err');
    } else if (res && res.ok) {
      const bits = `${res.images} image${res.images === 1 ? '' : 's'}${res.video ? ' + video' : ''}`;
      setStatus(`Sent to NotesGraph (${bits}). Finish in the opened tab.`, 'ok');
    } else {
      setStatus((res && res.error) || 'Failed to clip.', 'err');
    }
  });
});

document.getElementById('opts').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
