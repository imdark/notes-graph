const btn = document.getElementById('clip');
const status = document.getElementById('status');

function setStatus(msg, cls) {
  status.textContent = msg;
  status.className = 'status' + (cls ? ' ' + cls : '');
}

// The background worker answers as soon as the NotesGraph tab is open and
// reads the page after that, so this is only reached if the worker is stuck.
const START_MS = 10_000;

btn.addEventListener('click', () => {
  btn.disabled = true;
  setStatus('Creating the note…');
  let answered = false;
  const timer = setTimeout(() => {
    if (answered) return;
    answered = true;
    btn.disabled = false;
    setStatus(
      "The clipper didn't start. Reload the page and try again.",
      'err'
    );
  }, START_MS);
  chrome.runtime.sendMessage({ type: 'clip-active-tab' }, res => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    btn.disabled = false;
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, 'err');
    } else if (res && res.ok) {
      setStatus(
        'Clipping in the background. The note gets its title and link first, then the text and images. You can close this.',
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
