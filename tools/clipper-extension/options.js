const input = document.getElementById('base');
const saved = document.getElementById('saved');

chrome.storage.sync.get('appBaseUrl', ({ appBaseUrl }) => {
  input.value = appBaseUrl || 'https://app.notesgraph.com';
});

document.getElementById('save').addEventListener('click', () => {
  const appBaseUrl = input.value.trim().replace(/\/+$/, '');
  chrome.storage.sync.set({ appBaseUrl }, () => {
    saved.textContent = 'Saved';
    setTimeout(() => (saved.textContent = ''), 1500);
  });
});
