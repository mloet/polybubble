// content.js - Scan webpage for images and add detection functionality

// Global variables to track processed images and detection results
const identifiedImages = new Set();
const processingImages = new Map(); // Maps image IDs to processing status
let autoDetectEnabled = false; // Flag to track auto-detection state
let visibilityObserver = null;
let observer = null;

// Initialize when the page is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initializeImageDetection, 500);
});

// Also run initialization on load for cases where DOMContentLoaded already fired
window.addEventListener('load', () => {
  if (identifiedImages.size === 0) {
    setTimeout(initializeImageDetection, 500);
  }
});

// Run immediately if document is already complete
if (document.readyState === 'complete') {
  setTimeout(initializeImageDetection, 500);
}

// Set up message listener for responses from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleAutoDetect') {
    autoDetectEnabled = !autoDetectEnabled;
    console.log(`Auto-detect is now ${autoDetectEnabled ? 'enabled' : 'disabled'}`);
    if (autoDetectEnabled) {
      identifiedImages.forEach((img) => {
        if (img.naturalWidth >= 400 && img.naturalHeight >= 400 && !img.dataset.detectionSrc && isImageVisible(img)) {
          handleDetectionRequest(img);
        }
      });
    }
  }
});

// Main initialization function
function initializeImageDetection() {
  // Disconnect any existing observer to prevent recursion
  if (observer) {
    observer.disconnect();
  }

  // Find all images on the page that meet minimum size requirements
  const images = document.querySelectorAll('img');

  images.forEach(processImage);

  // Set up a MutationObserver to handle dynamically added images
  setupMutationObserver();

  setupVisibilityObserver();
}

// Process a single image
function processImage(img) {
  // Skip if already processed or invalid
  if (identifiedImages.has(img) || !img.src || img.src.startsWith('data:') || img.closest('.comic-bubble-detector-wrapper')) {
    return;
  }

  // Check if image is loaded and has sufficient size
  if (img.complete) {
    if (img.naturalWidth >= 400 && img.naturalHeight >= 400) {
      identifiedImages.add(img);
      addDetectionButton(img);
      // visibilityObserver.observe(img);
    }
  } else {
    // If not loaded, add a one-time load listener
    img.addEventListener('load', function onLoad() {
      img.removeEventListener('load', onLoad);
      if (img.naturalWidth >= 400 && img.naturalHeight >= 400 && !identifiedImages.has(img)) {
        identifiedImages.add(img);
        addDetectionButton(img);
        // visibilityObserver.observe(img); 
      }
    }, { once: true });
  }

  if (autoDetectEnabled) {
    // If auto-detect is enabled, trigger detection immediately
    if (img.naturalWidth >= 400 && img.naturalHeight >= 400 && !img.dataset.detectionSrc && isImageVisible(img)) {
      handleDetectionRequest(img);
    }
  }
}

// Add detection button to an image
function addDetectionButton(img) {
  // Skip if already has detection elements
  if (img.detectorElements || img.closest('.comic-bubble-detector-wrapper')) {
    return;
  }

  // Temporarily disable observer to prevent recursion
  if (observer) {
    observer.disconnect();
  }

  // Create wrapper element
  const wrapper = document.createElement('div');
  wrapper.className = 'comic-bubble-detector-wrapper';
  wrapper.style.position = 'relative'; // Ensure relative positioning for the button

  // Create detection button
  const button = document.createElement('button');
  button.className = 'comic-bubble-detector-button';
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/icon.png');
  icon.alt = 'Detect comic bubbles';
  icon.style.width = '50px';
  icon.style.height = '50px';
  button.appendChild(icon);
  button.title = 'Detect comic bubbles';

  // Create toggle button
  const toggleButton = document.createElement('button');
  toggleButton.className = 'comic-bubble-toggle-button';
  toggleButton.textContent = 'HIDE'; // Default state
  toggleButton.style.display = 'none'; // Initially hidden

  // Insert wrapper before the image in DOM
  try {
    const parent = img.parentNode;
    if (parent) {
      // Insert wrapper
      parent.insertBefore(wrapper, img);

      // Move image inside wrapper
      wrapper.appendChild(img);

      // Add buttons
      wrapper.appendChild(button);
      wrapper.appendChild(toggleButton);

      // Store reference to elements
      img.detectorElements = {
        wrapper,
        button,
        toggleButton,
      };

      // Store the original image src
      img.dataset.originalSrc = img.src;

      // Add click handler for detection button
      button.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent click from affecting underlying elements

        // If currently processing, do nothing
        if (button.dataset.processing === 'true') {
          return;
        }

        img.src = img.dataset.originalSrc;

        // If no results yet, process the image
        handleDetectionRequest(img);
      });

      // Add click handler for toggle button
      toggleButton.addEventListener('click', (event) => {
        event.stopPropagation();

        // Toggle between original and detection result
        if (img.src === img.dataset.originalSrc) {
          img.src = img.dataset.detectionSrc || img.src; // Switch to detection result
          toggleButton.textContent = 'HIDE';
        } else {
          img.src = img.dataset.originalSrc; // Switch back to original
          toggleButton.textContent = 'SHOW';
        }
      });
    }
  } catch (error) {
    console.error('Error adding detection button:', error);
  }

  // Re-enable observer
  setupMutationObserver();
}

function detectImage(imageData, imageId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'initWebpageDetection',
      imageData: imageData,
      imageId: imageId
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.results);
      }
    });
  });
}

async function handleDetectionRequest(img) {
  const imageId = img.dataset.detectorId || `img_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  img.dataset.detectorId = imageId;

  if (processingImages.has(imageId)) {
    console.log(`Image ${imageId} is already being processed, ignoring request`);
    return;
  }

  processingImages.set(imageId, true);

  const { button, toggleButton } = img.detectorElements;
  const icon = button.querySelector('img');
  if (toggleButton) {
    toggleButton.style.display = 'none'; // Hide toggle button during processing
  }
  if (icon) {
    icon.alt = 'Processing...';
    button.dataset.processing = 'true';
    button.title = 'Processing image...';
    // button.classList.add('processing');
  }

  const cycleImages = ['icons/ellipses1.png', 'icons/ellipses2.png', 'icons/ellipses.png'];
  let cycleIndex = 0;
  const cycleInterval = setInterval(() => {
    if (icon) {
      icon.src = chrome.runtime.getURL(cycleImages[cycleIndex]);
      cycleIndex = (cycleIndex + 1) % cycleImages.length;
    }
  }, 1000);

  try {
    // Convert the image to base64
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = canvas.toDataURL('image/png');

    if (!imageData || imageData === 'data:,') {
      throw new Error('Failed to convert image to data URL');
    }

    console.log(`Starting detection for image ${imageId}`);
    const results = await detectImage(imageData, imageId);

    // Handle successful detection
    img.dataset.detectionSrc = results.url;
    img.src = img.dataset.detectionSrc;

    // const { toggleButton } = img.detectorElements;
    toggleButton.textContent = 'HIDE';
    toggleButton.style.display = 'inline-block';

    console.log(`Detection completed for image ${imageId}`);
  } catch (error) {
    console.error(`Error processing image ${imageId}: ${error.message}`);
    handleDetectionError(img, error.message);
  } finally {
    processingImages.delete(imageId);
    clearInterval(cycleInterval);

    if (icon) {
      icon.src = chrome.runtime.getURL('icons/retry.png');
      icon.alt = 'Retry detection';
      button.dataset.processing = 'false';
      // button.classList.remove('processing');
      button.title = 'Retry detection';
    }
  }
}

function isImageVisible(img) {
  if (!img || img.offsetParent === null) {
    // Element is not in the DOM or is hidden with display: none
    return false;
  }

  const rect = img.getBoundingClientRect();

  // Check if the image is within the viewport
  const isInViewport = (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );

  // Check if the image has a size and is not hidden with visibility: hidden or opacity: 0
  const isVisible = (
    rect.width > 0 &&
    rect.height > 0 &&
    window.getComputedStyle(img).visibility !== 'hidden' &&
    window.getComputedStyle(img).opacity !== '0'
  );

  return isInViewport && isVisible;
}

function isCrossOrigin(url) {
  // Data URLs are same-origin
  if (url.startsWith('data:')) {
    return false;
  }

  try {
    const srcUrl = new URL(url);
    const locationUrl = new URL(window.location.href);

    // Compare origin parts
    return srcUrl.origin !== locationUrl.origin;
  } catch (e) {
    // If URL parsing fails, assume it's cross-origin
    return true;
  }
}

function setupVisibilityObserver() {
  // Clean up any existing observer
  if (visibilityObserver) {
    visibilityObserver.disconnect();
  }

  // Create a new IntersectionObserver
  visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const img = entry.target;

      // If the image is visible and auto-detect is enabled, process it
      if (entry.isIntersecting && autoDetectEnabled && !img.dataset.detectionSrc) {
        visibilityObserver.unobserve(img); // Stop observing this image
        handleDetectionRequest(img); // Trigger detection
      }
    });
  });

  identifiedImages.forEach((img) => {
      if (img.naturalWidth >= 400 && img.naturalHeight >= 400 && !img.dataset.detectionSrc) {
        visibilityObserver.observe(img);
      }
    }
  );
}

function setupMutationObserver() {
  // Clean up existing observer
  if (observer) {
    observer.disconnect();
  }

  // Create new observer
  observer = new MutationObserver((mutations) => {
    let newImages = [];

    // Collect all new images
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          // Direct image nodes
          if (node.nodeName === 'IMG') {
            newImages.push(node);
          }

          // Images inside added elements
          if (node.nodeType === Node.ELEMENT_NODE) {
            const images = node.querySelectorAll('img');
            images.forEach((img) => newImages.push(img));
          }
        });
      }
    });

    // Deduplicate images
    newImages = [...new Set(newImages)];

    // Process and observe new images
    newImages.forEach((img) => {
      processImage(img);
      if (img.naturalWidth >= 400 && img.naturalHeight >= 400) {
        visibilityObserver.observe(img);
      }
    });
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}