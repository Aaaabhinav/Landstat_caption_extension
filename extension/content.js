// Content script injected into NASA Landsat page
// This script interacts with the page DOM to generate and capture images

(function() {
  // Prevent double injection
  if (window.__nasaLandsatExtensionLoaded) return;
  window.__nasaLandsatExtensionLoaded = true;

  console.log('[NASA Landsat Downloader] Content script loaded');

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'processCaption') {
      processCaption(message.caption, message.index, message.total)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // async
    }

    if (message.action === 'ping') {
      sendResponse({ alive: true });
      return;
    }

    if (message.action === 'getCaptionsFromPage') {
      // Try to read any existing text from the input
      const input = document.querySelector('input[type="text"], input:not([type])');
      sendResponse({ 
        found: !!input, 
        value: input ? input.value : '' 
      });
      return;
    }
  });

  async function processCaption(text, index, total) {
    try {
      showOverlay(`Processing "${text}" (${index + 1}/${total})...`);

      // Find the input field
      const input = document.querySelector('input[type="text"], input:not([type])');
      if (!input) {
        throw new Error('Could not find the text input field on the page');
      }

      // Clear and type the caption
      input.focus();
      input.value = '';

      // Dispatch input events to trigger React/framework updates
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Also try sending keypress for Enter
      await sleep(500);
      
      // Try clicking a submit/generate button
      const submitBtn = findSubmitButton();
      if (submitBtn) {
        submitBtn.click();
      } else {
        // Try pressing Enter
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }

      // Wait for image to generate
      updateOverlay(`Waiting for "${text}" image to generate...`);
      await sleep(4000);

      // Try to find and download the generated image
      const imageResult = await captureImage(text);
      
      if (imageResult.success) {
        // If the page's own download button was clicked directly (fallback),
        // the image is already downloading — just report success
        if (imageResult.clickedDownload) {
          updateOverlay(`✓ "${text}" download triggered via page button!`);
          await sleep(1000);
          hideOverlay();
          return { success: true, caption: text, note: 'Downloaded via page button (check default Downloads folder)' };
        }

        updateOverlay(`Downloading "${text}"...`);
        
        // Send download request to background (saves to nasa_images/)
        const downloadResult = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'downloadImage',
            url: imageResult.url,
            filename: `${text}_landsat.png`
          }, resolve);
        });

        if (downloadResult.success) {
          updateOverlay(`✓ "${text}" downloaded to nasa_images/!`);
          await sleep(1000);
          hideOverlay();
          return { success: true, caption: text };
        } else {
          throw new Error(downloadResult.error || 'Download failed');
        }
      } else {
        throw new Error(imageResult.error || 'Could not capture image');
      }

    } catch (err) {
      updateOverlay(`✗ Error for "${text}": ${err.message}`);
      await sleep(2000);
      hideOverlay();
      return { success: false, error: err.message, caption: text };
    }
  }

  function findSubmitButton() {
    // Try various selectors for submit/generate button
    const selectors = [
      '#submitBtn',
      '#generateBtn',
      'button[type="submit"]',
      'button.submit',
      'button.generate',
      'input[type="submit"]',
    ];
    
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }

    // Try finding button by text content
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.toLowerCase();
      if (text.includes('go') || text.includes('submit') || text.includes('generate') || text.includes('search')) {
        return btn;
      }
    }

    return null;
  }

  async function captureImage(caption) {
    // Strategy 1 (PREFERRED): Find the generated canvas and convert to data URL
    // This lets us download through the background script into nasa_images/
    const canvases = document.querySelectorAll('canvas');
    if (canvases.length > 0) {
      // Use the largest canvas (likely the output)
      let largestCanvas = canvases[0];
      let maxArea = 0;
      canvases.forEach(c => {
        const area = c.width * c.height;
        if (area > maxArea) {
          maxArea = area;
          largestCanvas = c;
        }
      });

      try {
        const dataUrl = largestCanvas.toDataURL('image/png');
        if (dataUrl && dataUrl !== 'data:,') {
          console.log('[NASA Landsat Downloader] Captured canvas image');
          return { success: true, url: dataUrl };
        }
      } catch (e) {
        // Canvas may be tainted (cross-origin)
        console.warn('[NASA Landsat Downloader] Canvas tainted, trying alternative method');
      }
    }

    // Strategy 2: Find a download link with an actual href
    const downloadLink = document.querySelector('a[download], a[href*="download"]');
    if (downloadLink && downloadLink.href && downloadLink.href !== window.location.href) {
      console.log('[NASA Landsat Downloader] Found download link:', downloadLink.href);
      return { success: true, url: downloadLink.href };
    }

    // Strategy 3: Find generated image element
    const images = document.querySelectorAll('img');
    let bestImage = null;
    let maxSize = 0;
    
    images.forEach(img => {
      const size = img.naturalWidth * img.naturalHeight;
      // Look for larger, recently visible images (skip icons/logos)
      if (size > maxSize && img.src && !img.src.includes('icon') && !img.src.includes('logo')) {
        maxSize = size;
        bestImage = img;
      }
    });

    if (bestImage && bestImage.src) {
      console.log('[NASA Landsat Downloader] Found image element:', bestImage.src.substring(0, 80));
      return { success: true, url: bestImage.src };
    }

    // Strategy 4: Look for SVG output
    const svgs = document.querySelectorAll('svg.output, svg.result, .output svg, .result svg');
    if (svgs.length > 0) {
      const svgData = new XMLSerializer().serializeToString(svgs[0]);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(svgBlob);
      console.log('[NASA Landsat Downloader] Captured SVG output');
      return { success: true, url: url };
    }

    // Strategy 5 (FALLBACK): Click the page's download button directly
    // Note: this saves to the default Downloads folder, NOT nasa_images/
    const downloadBtn = document.querySelector('#downloadBtn, .download-btn, button[download]');
    if (downloadBtn) {
      console.log('[NASA Landsat Downloader] Clicking page download button as fallback');
      downloadBtn.click();
      return { success: true, url: null, clickedDownload: true };
    }

    return { success: false, error: 'No downloadable image found on the page' };
  }

  // Overlay UI functions
  function showOverlay(text) {
    let overlay = document.getElementById('nasa-ext-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'nasa-ext-overlay';
      overlay.innerHTML = `
        <div class="nasa-ext-overlay-content">
          <div class="nasa-ext-spinner"></div>
          <p class="nasa-ext-status"></p>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.nasa-ext-status').textContent = text;
    overlay.style.display = 'flex';
  }

  function updateOverlay(text) {
    const overlay = document.getElementById('nasa-ext-overlay');
    if (overlay) {
      overlay.querySelector('.nasa-ext-status').textContent = text;
    }
  }

  function hideOverlay() {
    const overlay = document.getElementById('nasa-ext-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
