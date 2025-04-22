// content.js - Scan webpage for images and add detection functionality

// Global variables to track processed images and detection results
const processedImages = new Set();
const processingImages = new Map(); // Maps image IDs to processing status
const detectionResults = new Map();
let observer = null;

// Initialize when the page is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initializeImageDetection, 500);
});

// Also run initialization on load for cases where DOMContentLoaded already fired
window.addEventListener('load', () => {
  if (processedImages.size === 0) {
    setTimeout(initializeImageDetection, 500);
  }
});

// Run immediately if document is already complete
if (document.readyState === 'complete') {
  setTimeout(initializeImageDetection, 500);
}

// Set up message listener for responses from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "detectionCompleted") {
    console.log("Got detection completed message:", message);
    handleDetectionResults(message.imageId, message.results, message.error);
    return false;
  }

  if (message.action === 'detectAllImages') {
    const images = document.querySelectorAll('img');
    images.forEach((img) => {
      if (img.naturalWidth >= 400 && img.naturalHeight >= 400) {
        handleDetectionRequest(img);
      }
    });
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
}

// Process a single image
function processImage(img) {
  // Skip if already processed or invalid
  if (processedImages.has(img) || !img.src || img.src.startsWith('data:') || img.closest('.comic-bubble-detector-wrapper')) {
    return;
  }

  // Check if image is loaded and has sufficient size
  if (img.complete) {
    if (img.naturalWidth >= 400 && img.naturalHeight >= 400) {
      processedImages.add(img);
      addDetectionButton(img);
    }
  } else {
    // If not loaded, add a one-time load listener
    img.addEventListener('load', function onLoad() {
      img.removeEventListener('load', onLoad);
      if (img.naturalWidth >= 400 && img.naturalHeight >= 400 && !processedImages.has(img)) {
        processedImages.add(img);
        addDetectionButton(img);
      }
    }, { once: true });
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

// Handle click on detection button
function handleDetectionRequest(img) {
  // Generate a unique ID for this image if not already assigned
  const imageId = img.dataset.detectorId || `img_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  img.dataset.detectorId = imageId;

  // Check if already processing
  if (processingImages.has(imageId) || img.detectorElements.button.dataset.processing === 'true') {
    console.log(`Image ${imageId} is already being processed, ignoring request`);
    return;
  }

  // Reset the image to its original source before processing
  if (img.src !== img.dataset.originalSrc) {
    console.log(`Resetting image ${imageId} to its original source before retrying detection`);
    img.src = img.dataset.originalSrc;
  }

  // Mark as processing
  processingImages.set(imageId, true);

  const { button } = img.detectorElements;

  // Show loading state
  const icon = button.querySelector('img');
  if (icon) {
    icon.alt = 'Processing...';
  }

  button.dataset.processing = 'true';
  button.title = 'Processing image...';

  const cycleImages = ['icons/ellipses1.png', 'icons/ellipses2.png', 'icons/ellipses.png'];
  let cycleIndex = 0;
  const cycleInterval = setInterval(() => {
    if (icon) {
      icon.src = chrome.runtime.getURL(cycleImages[cycleIndex]);
      cycleIndex = (cycleIndex + 1) % cycleImages.length;
    }
  }, 1000);

  console.log(`Starting detection for image ${imageId}`);

  // Try to convert image to base64
  try {
    // Check for cross-origin restrictions
    if (isCrossOrigin(img.src) && !img.crossOrigin) {
      throw new Error('Cross-origin image cannot be processed. Try right-clicking and saving the image first.');
    }

    // Create off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext('2d');

    try {
      // This may fail for cross-origin images
      ctx.drawImage(img, 0, 0);

      // Get base64 data
      const imageData = canvas.toDataURL('image/png');

      // Check if imageData is a valid base64 string
      if (!imageData || imageData === 'data:,') {
        throw new Error('Failed to convert image to data URL');
      }

      console.log(`Successfully converted image to base64, sending to background`);

      // Send to background script
      chrome.runtime.sendMessage({
        action: 'initWebpageDetection',
        imageData: imageData,
        imageId: imageId
      }).catch(error => {
        console.error(`Error sending message to background script: ${error.message}`);
        handleDetectionError(img, `Failed to send message to extension: ${error.message}`);
      });

    } catch (canvasError) {
      throw new Error(`Canvas error: ${canvasError.message}`);
    }
  } catch (e) {
    // Handle all errors
    console.error(`Error processing image: ${e.message}`);
    handleDetectionError(img, e.message);
  } finally {
    // Stop cycling images when processing is complete
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "detectionCompleted" && message.imageId === imageId) {
        clearInterval(cycleInterval); // Stop cycling
        if (icon) {
          icon.src = chrome.runtime.getURL('icons/retry.png'); // Reset to default icon
          icon.alt = 'Detect comic bubbles';
        }
      }
    });
  }
}

// Check if an image is cross-origin
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

// Handle detection errors
function handleDetectionError(img, errorMessage) {
  if (!img.detectorElements) return;

  // const { button, resultsContainer } = img.detectorElements;
  const imageId = img.dataset.detectorId;

  // // Display error message
  // resultsContainer.innerHTML = '';
  // const errorDiv = document.createElement('div');
  // errorDiv.textContent = `Error: ${errorMessage}`;
  // errorDiv.style.position = 'absolute';
  // errorDiv.style.top = '50%';
  // errorDiv.style.left = '50%';
  // errorDiv.style.transform = 'translate(-50%, -50%)';
  // errorDiv.style.background = 'rgba(255, 0, 0, 0.7)';
  // errorDiv.style.color = 'white';
  // errorDiv.style.padding = '10px';
  // errorDiv.style.borderRadius = '5px';
  // errorDiv.style.fontSize = '14px';
  // errorDiv.style.maxWidth = '80%';
  // errorDiv.style.textAlign = 'center';

  // resultsContainer.style.display = 'block';
  // resultsContainer.appendChild(errorDiv);

  // Clear processing status
  if (imageId) {
    processingImages.delete(imageId);
  }
}

// Handle detection results - with improved error handling
function handleDetectionResults(imageId, results, error) {
  console.log(`Received detection results for image ${imageId}`);

  // Find the image with this ID
  const img = document.querySelector(`[data-detector-id="${imageId}"]`);

  if (!img || !img.detectorElements) {
    console.error(`Image not found for results: ${imageId}`);
    return;
  }

  const { button, toggleButton } = img.detectorElements;

  // Update button state
  button.dataset.processing = 'false';

  // Clear processing status
  processingImages.delete(imageId);

  // Handle errors
  const icon = button.querySelector('img');
  if (icon) {
    if (error) {
      icon.src = chrome.runtime.getURL('icons/retry.png');
      icon.alt = 'Error occurred';
      button.title = 'Error occurred. Click to retry.';
    } else {
      icon.src = chrome.runtime.getURL('icons/retry.png');
      icon.alt = 'Retry detection';
      button.title = 'Retry detection';
    }
  }

  if (error) {
    handleDetectionError(img, error);
    return;
  }

  // Store the detection result URL
  img.dataset.detectionSrc = results.url;

  // Set the image source to the detection result by default
  img.src = img.dataset.detectionSrc;

  // Update the toggle button text to "SHOW" (to allow switching back to the original image)
  toggleButton.textContent = 'SHOW';

  // Make the toggle button visible
  toggleButton.style.display = 'inline-block';
}

function setupMutationObserver() {
  // Clean up existing observer
  if (observer) {
    observer.disconnect();
  }

  // Create new observer
  observer = new MutationObserver((mutations) => {
    let newImages = [];

    // First collect all new images
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          // Direct image nodes
          if (node.nodeName === 'IMG') {
            newImages.push(node);
          }

          // Images inside added elements
          if (node.nodeType === Node.ELEMENT_NODE) {
            const images = node.querySelectorAll('img');
            images.forEach(img => newImages.push(img));
          }
        });
      }
    });

    // Deduplicate images
    newImages = [...new Set(newImages)];

    // Process in batches to avoid stack overflow
    if (newImages.length > 0) {
      // Process first 10 images immediately
      const firstBatch = newImages.slice(0, 10);
      firstBatch.forEach(processImage);

      // Process remaining images with delay
      if (newImages.length > 10) {
        const remainingBatches = [];
        for (let i = 10; i < newImages.length; i += 10) {
          remainingBatches.push(newImages.slice(i, i + 10));
        }

        // Process remaining batches with increasing delays
        remainingBatches.forEach((batch, index) => {
          setTimeout(() => {
            batch.forEach(processImage);
          }, 100 * (index + 1));
        });
      }
    }
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}