// background.js - Service worker that manages the offscreen document

// Storage for service settings
let serviceSettings = {
  googleApiKey: '',
  deeplApiKey: '',
  ocrService: 'tesseract',
  translationService: 'deepl',
  sourceLanguage: 'AUTO',
  targetLanguage: 'EN'
};

// Load saved settings when background script starts
chrome.storage.sync.get([
  'googleApiKey',
  'deeplApiKey',
  'ocrService',
  'translationService',
  'sourceLanguage',
  'targetLanguage'
], function (items) {
  if (items.googleApiKey) serviceSettings.googleApiKey = items.googleApiKey;
  if (items.deeplApiKey) serviceSettings.deeplApiKey = items.deeplApiKey;
  if (items.ocrService) serviceSettings.ocrService = items.ocrService;
  if (items.translationService) serviceSettings.translationService = items.translationService;
  if (items.sourceLanguage) serviceSettings.sourceLanguage = items.sourceLanguage;
  if (items.targetLanguage) serviceSettings.targetLanguage = items.targetLanguage;
});

// Global map to store pendingRequests with their callbacks and metadata
const pendingRequests = new Map();
let requestId = 0;

// Register listeners
if (!globalThis.listenersRegistered) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-auto-detection") {
      // Send a message to all tabs to toggle auto-detection
      chrome.tabs.query({ url: "<all_urls>" }, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, { action: "toggleAutoDetect" });
        });
      });
    }
  });

  // Handle messages from popup.js or content.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle settings updates from popup
    if (message.action === "updateserviceSettings") {
      // Update settings
      if (message.settings.googleApiKey !== undefined) {
        serviceSettings.googleApiKey = message.settings.googleApiKey;
      }
      if (message.settings.deeplApiKey !== undefined) {
        serviceSettings.deeplApiKey = message.settings.deeplApiKey;
      }
      if (message.settings.ocrService !== undefined) {
        serviceSettings.ocrService = message.settings.ocrService;
      }
      if (message.settings.translationService !== undefined) {
        serviceSettings.translationService = message.settings.translationService;
      }
      if (message.settings.sourceLanguage !== undefined) {
        serviceSettings.sourceLanguage = message.settings.sourceLanguage;
      }
      if (message.settings.targetLanguage !== undefined) {
        serviceSettings.targetLanguage = message.settings.targetLanguage;
      }

      console.log('Service settings updated');

      return false;
    }

    if (message.action === "initWebpageDetection") {
      const { imageData, imageId } = message;

      (async () => {
        try {
          // Ensure the offscreen document is active
          const offscreenReady = await ensureOffscreenDocument();
          if (!offscreenReady) {
            throw new Error("Failed to create offscreen document");
          }

          // Forward the detection request to the offscreen document
          chrome.runtime.sendMessage(
            { action: "detectObjects", imageData, imageId, serviceSettings },
            (response) => {
              if (response.error) {
                sendResponse({ error: response.error });
              } else {
                sendResponse({ results: response.results });
              }
            }
          );
        } catch (error) {
          sendResponse({ error: error.message });
        }
      })();

      return true;
    }
  });

  // Listen for keyboard shortcuts
  chrome.commands.onCommand.addListener((command) => {
    if (command === "open-popup") {
      // Open the popup
      chrome.action.openPopup();
    }
  });

  globalThis.listenersRegistered = true;
}

// Ensure offscreen document is active
async function ensureOffscreenDocument() {
  try {
    // Check if offscreen document is already open
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenExists = existingContexts.some(
      (context) => context.contextType === "OFFSCREEN_DOCUMENT"
    );

    // Create offscreen document if it doesn't exist
    if (!offscreenExists) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run ONNX model for object detection"
      });
      console.log("Offscreen document created successfully");
    } else {
      console.log("Offscreen document already exists");
    }
    return true;
  } catch (error) {
    console.error("Error with offscreen document:", error);
    return false;
  }
}

// Add request to queue and process if possible
// function addToQueue(imageData, requestId, settings) {
//   requestQueue.push({ imageData, requestId, settings });
//   processNextInQueue();
// }

// // Process next request in queue
// function processNextInQueue() {
//   if (isProcessing || requestQueue.length === 0) return;

//   isProcessing = true;
//   const { imageData, requestId, settings } = requestQueue.shift();

//   processDetectionRequest(imageData, requestId, settings)
//     .finally(() => {
//       isProcessing = false;
//       processNextInQueue();
//     });
// }

// // Process detection request by forwarding to offscreen document
// async function processDetectionRequest(imageData, requestId, settings) {
//   return new Promise(async (resolve, reject) => {
//     try {
//       const offscreenReady = await ensureOffscreenDocument();

//       if (!offscreenReady) {
//         handleDetectionError(requestId, "Failed to create offscreen document");
//         reject(new Error("Failed to create offscreen document"));
//         return;
//       }

//       // Set a timeout for the request
//       const timeout = setTimeout(() => {
//         handleDetectionError(requestId, "Request timed out after 30 seconds");
//         reject(new Error("Request timed out"));
//       }, 120000); // 30 second timeout

//       // Store timeout reference
//       const existingData = pendingRequests.get(requestId) || {};
//       pendingRequests.set(requestId, {
//         ...existingData,
//         timeout: timeout
//       });

//       console.log(`Forwarding detection request to offscreen document for request ${requestId}`);

//       // Forward the request to the offscreen document
//       chrome.runtime.sendMessage({
//         action: "detectObjects",
//         imageData: imageData,
//         requestId: requestId,
//         serviceSettings: settings
//       }).catch(error => {
//         clearTimeout(timeout);
//         handleDetectionError(requestId, `Error sending to offscreen document: ${error.message}`);
//         reject(error);
//       });
//     } catch (error) {
//       handleDetectionError(requestId, `Error in detection process: ${error.message}`);
//       reject(error);
//     }
//   });
// }

// // Handle detection errors
// function handleDetectionError(requestId, errorMessage) {
//   console.error(`Detection error for request ${requestId}: ${errorMessage}`);

//   const requestData = pendingRequests.get(requestId);
//   if (!requestData) return;

//   const { callback, sourceTabId, imageId, source, timeout } = requestData;

//   // Clear timeout if it exists
//   if (timeout) {
//     clearTimeout(timeout);
//   }

//   // Send error to popup if applicable
//   if (source === 'popup' && callback) {
//     callback({ error: errorMessage });
//   }

//   // Send error to content script if applicable
//   if (source === 'content' && sourceTabId && imageId) {
//     chrome.tabs.sendMessage(sourceTabId, {
//       action: "detectionCompleted",
//       imageId: imageId,
//       error: errorMessage
//     }).catch(err => {
//       console.error(`Error sending error to tab ${sourceTabId}:`, err);
//     });
//   }

//   // Clean up the request data
//   pendingRequests.delete(requestId);

//   // Process next item in queue
//   isProcessing = false;
//   processNextInQueue();
// }
