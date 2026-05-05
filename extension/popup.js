// NASA Landsat Image Downloader - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const captionInput = document.getElementById('captionInput');
  const captionPreview = document.getElementById('captionPreview');
  const captionTags = document.getElementById('captionTags');
  const generateBtn = document.getElementById('generateBtn');
  const openPageBtn = document.getElementById('openPageBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const progressSection = document.getElementById('progressSection');
  const progressLabel = document.getElementById('progressLabel');
  const progressCount = document.getElementById('progressCount');
  const progressBar = document.getElementById('progressBar');
  const progressLog = document.getElementById('progressLog');

  let isOnNasaPage = false;
  let currentTabId = null;
  let isProcessing = false;

  // ===== Initialize =====
  init();

  async function init() {
    // Load saved captions
    const saved = await chrome.storage.local.get('lastCaptions');
    if (saved.lastCaptions) {
      captionInput.value = saved.lastCaptions;
      updatePreview();
    }

    // Check if user is on NASA page
    checkCurrentTab();
  }

  function checkCurrentTab() {
    chrome.runtime.sendMessage({ action: 'checkTab' }, (response) => {
      if (response && response.isNasaPage) {
        isOnNasaPage = true;
        currentTabId = response.tabId;
        setStatus('ready', 'Connected to NASA Landsat page');
        openPageBtn.style.display = 'none';
        updateButtonState();
      } else {
        isOnNasaPage = false;
        setStatus('offline', 'Not on NASA Landsat page');
        openPageBtn.style.display = 'flex';
        generateBtn.style.display = 'none';
      }
    });
  }

  function setStatus(type, text) {
    statusBadge.className = `status-badge status-${type}`;
    statusText.textContent = text;
  }

  // ===== Caption Input =====
  captionInput.addEventListener('input', () => {
    updatePreview();
    updateButtonState();
    // Save to storage
    chrome.storage.local.set({ lastCaptions: captionInput.value });
  });

  captionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !generateBtn.disabled) {
      startProcessing();
    }
  });

  function updatePreview() {
    const captions = getCaptions();
    if (captions.length > 0) {
      captionPreview.style.display = 'block';
      captionTags.innerHTML = captions
        .map(c => `<span class="caption-tag">${c}</span>`)
        .join('');
    } else {
      captionPreview.style.display = 'none';
      captionTags.innerHTML = '';
    }
  }

  function getCaptions() {
    return captionInput.value
      .trim()
      .split(/\s+/)
      .filter(c => c.length > 0);
  }

  function updateButtonState() {
    const captions = getCaptions();
    generateBtn.disabled = !isOnNasaPage || captions.length === 0 || isProcessing;
  }

  // ===== Open NASA Page =====
  openPageBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openNasaPage' }, (response) => {
      if (response && response.success) {
        // Close popup — user will reopen after page loads
        window.close();
      }
    });
  });

  // ===== Generate & Download =====
  generateBtn.addEventListener('click', () => {
    if (!isProcessing) {
      startProcessing();
    }
  });

  async function startProcessing() {
    const captions = getCaptions();
    if (captions.length === 0 || !isOnNasaPage) return;

    isProcessing = true;
    generateBtn.disabled = true;
    captionInput.disabled = true;
    generateBtn.querySelector('span').textContent = 'Processing...';

    // Show progress
    progressSection.style.display = 'block';
    progressLog.innerHTML = '';
    progressBar.style.width = '0%';

    let successCount = 0;
    let errorCount = 0;

    // First, ensure content script is loaded
    try {
      await ensureContentScript();
    } catch (err) {
      addLogEntry('error', `Failed to inject script: ${err.message}`);
      resetUI();
      return;
    }

    for (let i = 0; i < captions.length; i++) {
      const caption = captions[i];
      const progress = ((i) / captions.length) * 100;
      progressBar.style.width = `${progress}%`;
      progressLabel.textContent = `Processing "${caption}"...`;
      progressCount.textContent = `${i + 1}/${captions.length}`;

      addLogEntry('pending', `Generating "${caption}"...`);

      try {
        const result = await sendToContentScript({
          action: 'processCaption',
          caption: caption,
          index: i,
          total: captions.length
        });

        if (result && result.success) {
          successCount++;
          updateLastLogEntry('success', `✓ "${caption}" downloaded`);
        } else {
          errorCount++;
          updateLastLogEntry('error', `✗ "${caption}": ${result?.error || 'Unknown error'}`);
        }
      } catch (err) {
        errorCount++;
        updateLastLogEntry('error', `✗ "${caption}": ${err.message}`);
      }

      // Small delay between captions
      if (i < captions.length - 1) {
        await sleep(1500);
      }
    }

    // Complete
    progressBar.style.width = '100%';
    progressLabel.textContent = 'Complete!';
    progressCount.textContent = `${successCount}/${captions.length} successful`;

    if (errorCount === 0) {
      addLogEntry('success', `All ${successCount} images downloaded to nasa_images/`);
    } else {
      addLogEntry('error', `${errorCount} failed, ${successCount} succeeded`);
    }

    resetUI();
  }

  function ensureContentScript() {
    return new Promise((resolve, reject) => {
      // First try to ping existing content script
      chrome.tabs.sendMessage(currentTabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script not loaded, inject it
          chrome.runtime.sendMessage(
            { action: 'injectContentScript', tabId: currentTabId },
            (injectResponse) => {
              if (injectResponse && injectResponse.success) {
                // Wait a bit for script to initialize
                setTimeout(resolve, 500);
              } else {
                reject(new Error(injectResponse?.error || 'Failed to inject content script'));
              }
            }
          );
        } else {
          resolve();
        }
      });
    });
  }

  function sendToContentScript(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(currentTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function addLogEntry(type, text) {
    const icons = {
      success: '✓',
      error: '✗',
      pending: '◌'
    };
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-icon">${icons[type]}</span><span>${text}</span>`;
    progressLog.appendChild(entry);
    progressLog.scrollTop = progressLog.scrollHeight;
  }

  function updateLastLogEntry(type, text) {
    const entries = progressLog.querySelectorAll('.log-entry');
    if (entries.length > 0) {
      const last = entries[entries.length - 1];
      const icons = { success: '✓', error: '✗', pending: '◌' };
      last.className = `log-entry ${type}`;
      last.innerHTML = `<span class="log-icon">${icons[type]}</span><span>${text}</span>`;
    }
  }

  function resetUI() {
    isProcessing = false;
    captionInput.disabled = false;
    generateBtn.querySelector('span').textContent = 'Generate & Download';
    updateButtonState();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
});
