// Background service worker for NASA Landsat Image Downloader

// Listen for download requests from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImage') {
    const { url, filename } = message;

    chrome.downloads.download({
      url: url,
      filename: `nasa_images/${filename}`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId: downloadId });
      }
    });

    return true; // Keep message channel open for async response
  }

  if (message.action === 'openNasaPage') {
    chrome.tabs.create({
      url: 'https://science.nasa.gov/specials/your-name-in-landsat/'
    }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  if (message.action === 'checkTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const isNasaPage = tabs[0].url && tabs[0].url.includes('science.nasa.gov/specials/your-name-in-landsat');
        sendResponse({ isNasaPage, tabId: tabs[0].id, url: tabs[0].url });
      } else {
        sendResponse({ isNasaPage: false });
      }
    });
    return true;
  }

  if (message.action === 'injectContentScript') {
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      files: ['content.js']
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }
});

// Track download progress
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    chrome.runtime.sendMessage({
      action: 'downloadProgress',
      downloadId: delta.id,
      state: delta.state.current
    }).catch(() => {
      // Popup may be closed, ignore error
    });
  }
});
