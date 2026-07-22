// Load saved preferences
document.addEventListener('DOMContentLoaded', async () => {
  const prefs = await chrome.storage.sync.get({
    ignoreImages: false,
    ignoreAttachments: false,
    includeToc: false,
    hideFooter: false,
    convertVideoLinks: false,
  });

  document.getElementById('ignoreImages').checked = prefs.ignoreImages;
  document.getElementById('ignoreAttachments').checked = prefs.ignoreAttachments;
  document.getElementById('includeToc').checked = prefs.includeToc;
  document.getElementById('hideFooter').checked = prefs.hideFooter;
  document.getElementById('convertVideoLinks').checked = prefs.convertVideoLinks;
});

// Save preferences
document.getElementById('saveBtn').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    ignoreImages: document.getElementById('ignoreImages').checked,
    ignoreAttachments: document.getElementById('ignoreAttachments').checked,
    includeToc: document.getElementById('includeToc').checked,
    hideFooter: document.getElementById('hideFooter').checked,
    convertVideoLinks: document.getElementById('convertVideoLinks').checked,
  });

  const msg = document.getElementById('saveMsg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2000);
});
