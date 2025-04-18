import * as ort from "onnxruntime-web";
import Tesseract, { PSM } from 'tesseract.js';
import { Image as ImageJS } from 'image-js';
import Typo from "typo-js";
import { nonMaxSuppression, base64ToCanvas, resizeCanvas, cropCanvas, calculateMidpointColors, applyEllipticalGradientMask, applyInverseEllipticalGradientMask } from './utils.js';


// Global service settings
let serviceSettings = {
  googleApiKey: '',
  deeplApiKey: '',
  ocrService: 'tesseract',
  translationService: 'deepl',
  sourceLanguage: 'AUTO',
  targetLanguage: 'EN'
};

// ONNX model path, confidence threshold, and label mapping
let session = null;
const MODEL_PATH = chrome.runtime.getURL("models/comic_text_bubble_detector.onnx");
const bubbleConfidence = 0.5;
const id2label = {
  0: "bubble",
  1: "text_bubble",
  2: "text_free",
};

// DeepL language code -> Tesseract language code
const languageMapping = {
  'AUTO': 'eng',
  'AR': 'ara',
  'BG': 'bul',
  'CS': 'ces',
  'DA': 'dan',
  'DE': 'deu',
  'EL': 'ell',
  'EN': 'eng',
  'ES': 'spa',
  'ET': 'est',
  'FI': 'fin',
  'FR': 'fra',
  'HU': 'hun',
  'ID': 'ind',
  'IT': 'ita',
  'JA': 'jpn',
  'KO': 'kor',
  'LT': 'lit',
  'LV': 'lav',
  'NB': 'nor',
  'NL': 'nld',
  'PL': 'pol',
  'PT': 'por',
  'RO': 'ron',
  'RU': 'rus',
  'SK': 'slk',
  'SL': 'slv',
  'SV': 'swe',
  'TR': 'tur',
  'UK': 'ukr',
  'ZH': 'chi_sim'
};

// Register listeners
if (!window.listenersRegistered) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Offscreen received message:", message.action);

    if (message.action === "detectObjects") {
      if (message.serviceSettings) {
        serviceSettings = message.serviceSettings;
        // console.log("Using service settings:", serviceSettings);
      }
      detectObjects(message.imageData, message.requestId);
    }

    return false;
  });
  window.listenersRegistered = true;
}

// Load the ONNX model
async function loadModel() {
  if (!session) {
    try {
      console.log("Loading ONNX model from:", MODEL_PATH);
      session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["wasm"]
      });
      console.log("Model loaded successfully");
    } catch (error) {
      console.error("Error loading model:", error);
      throw error;
    }
  }
}

// Initialize Tesseract worker
let workerPool = {}; // Language -> worker mapping

// Update initializeWorker to better handle concurrent requests
async function initializeWorker(lang = 'eng') {
  if (workerPool[lang]) {
    return workerPool[lang]; // Return existing worker for this language
  }

  const worker = await Tesseract.createWorker(lang, 1, {
    corePath: 'local_libraries/tesseract/tesseract.js-core',
    workerPath: 'local_libraries/tesseract/dist/worker.min.js',
    workerBlobURL: false
  });

  await worker.setParameters({
    preserve_interword_spaces: '1',
    tessedit_char_blacklist: '*#$¥%£&©®<=>@[\\/]^_{|}~0123456789¢€₹₩₽₺±×÷∞≈≠…•§¶°†‡"‹›«»–—‒™℠µ←→↑↓↔↕☑☐☒★☆',
  });

  workerPool[lang] = worker;
  console.log('Tesseract worker created with language:', lang);
  return worker;
}

// Perform OCR using Tesseract.js
async function performTesseractOCR(subsection, classIndex, x1, y1, scaleFactor, backgroundColor) {
  const lang = languageMapping[serviceSettings.sourceLanguage] || 'eng';
  let tesseract_worker = await initializeWorker(lang);

  applyEllipticalGradientMask(subsection, backgroundColor);

  let processedSubsection = await ImageJS.load(subsection.toDataURL());
  processedSubsection = processedSubsection.grey();
  if (classIndex === 2) processedSubsection = processedSubsection.gaussianFilter({ radius: 5 });
  if (backgroundColor.r < 30 && backgroundColor.g < 30 && backgroundColor.b < 30) processedSubsection = processedSubsection.invert();
  processedSubsection = processedSubsection.mask({ algorithm: 'otsu', threshold: 0.3 });
  // processedSubsection = processedSubsection.dilate({ iterations: 1 });
  console.log(processedSubsection.toDataURL());
  const { data: { text, blocks } } = await tesseract_worker.recognize(
    processedSubsection.toDataURL(),
    { tessedit_pageseg_mode: PSM.SINGLE_BLOCK },
    { blocks: true }
  );

  console.log("Tesseract OCR result:", text);
  console.log("Tesseract OCR blocks:", blocks);

  const filteredBlocks = classIndex === 2 ? blocks.filter(block => block.confidence >= 10) : blocks;

  if (filteredBlocks.length === 0) return { text: "", boxes: [], fontSize: 0 };

  let wordBoxes = [];
  let wordArray = [];
  let totalHeight = 0;
  let lineCount = 0;

  filteredBlocks.forEach(block => {
    block.paragraphs.forEach(paragraph => {
      paragraph.lines.forEach(line => {
        line.words.forEach(word => {
          let correctedWord = word.text;

          wordBoxes.push({
            boundingBox: [
              { x: x1 + word.bbox.x0 / scaleFactor.x, y: y1 + word.bbox.y0 / scaleFactor.y }, // Top-left
              { x: x1 + word.bbox.x1 / scaleFactor.x, y: y1 + word.bbox.y0 / scaleFactor.y }, // Top-right
              { x: x1 + word.bbox.x1 / scaleFactor.x, y: y1 + word.bbox.y1 / scaleFactor.y }, // Bottom-right
              { x: x1 + word.bbox.x0 / scaleFactor.x, y: y1 + word.bbox.y1 / scaleFactor.y }  // Bottom-left
            ]
          });
          wordArray.push(correctedWord);
        });
        if (line.confidence > 60 || classIndex !== 2) {
          totalHeight += line.rowAttributes.rowHeight;
          lineCount++;
        }
      });
    });
  });

  const fontSize = (totalHeight / lineCount) / scaleFactor.y;

  return {
    text, wordBoxes, fontSize
  };
}

// Fetch OCR results from Google Cloud Vision API
async function performGoogleOCR(imageSrc) {
  const apiKey = serviceSettings.googleApiKey;
  if (!apiKey) {
    console.error('Google Cloud Vision API key is missing');
    return { blocks: [] };
  }

  const googleSourceLang = serviceSettings.sourceLanguage === 'AUTO' ? null : serviceSettings.sourceLanguage.toLowerCase();

  try {
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageSrc.split(',')[1] },
          features: [{ type: 'TEXT_DETECTION' }],
          imageContext: googleSourceLang ? { languageHints: [googleSourceLang] } : undefined
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Google Cloud Vision API error: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.responses || !data.responses[0] || !data.responses[0].fullTextAnnotation) {
      console.log('No text detected by Google Cloud Vision API');
      return { blocks: [] };
    }

    const blocks = data.responses[0].fullTextAnnotation.pages[0].blocks.map(block => {
      const blockVertices = block.boundingBox.vertices;

      // Extract words and their bounding boxes
      const words = block.paragraphs.flatMap(paragraph =>
        paragraph.words.map(word => ({
          text: word.symbols.map(symbol => symbol.text).join(''),
          boundingBox: word.boundingBox.vertices
        }))
      );

      // Calculate font size based on the average height of word bounding boxes
      const totalHeight = words.reduce((sum, word) => {
        const wordHeight = Math.abs(word.boundingBox[3].y - word.boundingBox[0].y);
        return sum + wordHeight;
      }, 0);
      const fontSize = words.length > 0 ? totalHeight / words.length : 0;

      // Combine block-level data
      const joinedText = words.map(word => word.text).join(' ').replace(/\s+([.,!?])/g, '$1').replace(/-\s/g, '');;

      return {
        text: joinedText,
        boundingBox: blockVertices,
        fontSize,
        wordBoxes: words
      };
    });
    // console.log(data);

    return { blocks };
  } catch (error) {
    console.error('Error fetching Google Cloud Vision OCR results:', error);
    return { blocks: [] };
  }
}

// Translate text using Google Translate API
async function translateWithGoogle(text, forcedSourceLang = null, forcedTargetLang = null) {
  if (!text || text.trim() === '') {
    console.error('Translation error: Text is empty');
    return text;
  }

  const sourceLang = forcedSourceLang || serviceSettings.sourceLanguage;
  const targetLang = forcedTargetLang || serviceSettings.targetLanguage;
  const apiKey = serviceSettings.googleApiKey; // Use googleApiKey instead of apiKey

  if (!apiKey || (sourceLang === targetLang && sourceLang !== 'AUTO')) {
    console.log('Translation skipped: missing API key or same language');
    return text;
  }

  const googleSourceLang = sourceLang === 'AUTO' ? '' : sourceLang.toLowerCase();
  const googleTargetLang = targetLang.toLowerCase();

  try {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: text,
        source: googleSourceLang || null,
        target: googleTargetLang,
        format: "text"
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.data && data.data.translations && data.data.translations.length > 0) {
      return data.data.translations[0].translatedText;
    } else {
      throw new Error('Invalid response structure from Google Translate API');
    }
  } catch (error) {
    console.error('Google Translation error:', error);
    return text;
  }
}

// Translate text using DeepL API
async function translateWithDeepL(text, context, forcedSourceLang = null, forcedTargetLang = null) {
  if (!text || text.trim() === '') {
    console.error('Translation error: Text is empty');
    return text;
  }

  const sourceLang = forcedSourceLang || serviceSettings.sourceLanguage;
  const targetLang = forcedTargetLang || serviceSettings.targetLanguage;
  const apiKey = serviceSettings.deeplApiKey;

  if (!apiKey || (sourceLang === targetLang && sourceLang !== 'AUTO')) {
    console.log('Translation skipped: missing API key or same language');
    return text;
  }

  try {
    const response = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        auth_key: serviceSettings.deeplApiKey,
        text: text,
        context: context,
        source_lang: sourceLang.toUpperCase(),
        target_lang: targetLang.toUpperCase(),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.translations[0].text;
  } catch (error) {
    console.error('DeepL Translation error:', error);
    return text;
  }
}

// Translate text using the selected translation service
async function translateText(text, context = "", forcedSourceLang = null, forcedTargetLang = null) {
  const translationService = serviceSettings.translationService || 'deepl';

  if (translationService === 'deepl') {
    return translateWithDeepL(text, context, forcedSourceLang, forcedTargetLang);
  } else if (translationService === 'googleTranslate') {
    return translateWithGoogle(text, forcedSourceLang, forcedTargetLang);
  } else {
    console.error('Unknown translation service:', translationService);
    return text;
  }
}

// Perform object detection and OCR on the image
async function detectObjects(base64Image, requestId) {
  try {
    console.log("Processing image for detection");

    // Convert base64 to image data
    const canvas = await base64ToCanvas(base64Image);

    let googleOCRPromise = null;
    if (serviceSettings.ocrService === 'googleCloudVision') {
      googleOCRPromise = performGoogleOCR(base64Image);
    } else if (serviceSettings.ocrService === 'tesseract') {
      await initializeWorker(languageMapping[serviceSettings.sourceLanguage] || 'eng');
    }

    await loadModel();

    // Preprocess image
    const inputTensor = preprocessImage(canvas);

    // Run inference
    const outputs = await session.run({ pixel_values: inputTensor });
    console.log("Model inference completed");

    const googleResults = googleOCRPromise ? await googleOCRPromise : null;
    if (googleResults) {
      console.log("Google OCR results:", googleResults);
    }

    // Process results
    const results = await postprocessOutput(outputs, canvas, googleResults);
    console.log(`Found ${results.detections.length} detections`);

    // Send results back
    chrome.runtime.sendMessage({
      action: "detectionResults",
      results: results,
      requestId: requestId
    });

  } catch (error) {
    console.error("Detection error:", error);
    chrome.runtime.sendMessage({
      action: "detectionResults",
      error: error.message,
      requestId: requestId
    });
  }
}

// Preprocess the image for the model
function preprocessImage(canvas) {
  const targetWidth = 640;
  const targetHeight = 640;

  // Resize imageData
  const resizedImageData = resizeCanvas(canvas, targetWidth, targetHeight).getContext('2d').getImageData(0, 0, targetWidth, targetHeight);
  const data = resizedImageData.data;

  // Preprocessing parameters from preprocessor_config.json
  const imageMean = [0.485, 0.456, 0.406];
  const imageStd = [0.229, 0.224, 0.225];
  const rescaleFactor = 1 / 255.0;

  // Create a Float32Array for the input tensor
  const inputTensor = new Float32Array(3 * targetWidth * targetHeight);

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Normalize and rescale pixel values
    const r = data[i] * rescaleFactor;
    const g = data[i + 1] * rescaleFactor;
    const b = data[i + 2] * rescaleFactor;

    inputTensor[j] = (r - imageMean[0]) / imageStd[0]; // Red channel
    inputTensor[j + targetWidth * targetHeight] = (g - imageMean[1]) / imageStd[1]; // Green channel
    inputTensor[j + 2 * targetWidth * targetHeight] = (b - imageMean[2]) / imageStd[2]; // Blue channel
  }

  return new ort.Tensor('float32', inputTensor, [1, 3, targetHeight, targetWidth]);
}

// Postprocess the model output
async function postprocessOutput(outputs, canvas, googleResults) {

  const originalHeight = canvas.height;
  const originalWidth = canvas.width;
  const imageData = canvas.getContext('2d').getImageData(0, 0, originalWidth, originalHeight);
  const scaleFactor = { x: 4, y: 3 };
  const scaledCanvas = resizeCanvas(canvas, originalWidth * scaleFactor.x, originalHeight * scaleFactor.y);
  const logits = outputs.logits.data; // Classification logits
  const predBoxes = outputs.pred_boxes.data; // Bounding box predictions
  const numQueries = outputs.logits.dims[1]; // Number of object queries
  const numClasses = outputs.logits.dims[2]; // Number of classes (bubble, text_bubble, text_free)
  const detections = [];

  for (let i = 0; i < numQueries; i++) {
    // Extract class scores and bounding box
    const classScores = logits.slice(i * numClasses, (i + 1) * numClasses);
    const bbox = predBoxes.slice(i * 4, (i + 1) * 4);

    // Find the class with the highest score
    const maxScore = Math.max(...classScores);
    const classIndex = classScores.indexOf(maxScore);

    // Filter out low-confidence detections
    if (maxScore < bubbleConfidence || classIndex === 0) continue;

    // Convert bounding box from normalized [cx, cy, w, h] to [x1, y1, x2, y2]
    const cx = bbox[0] * originalWidth;
    const cy = bbox[1] * originalHeight;
    const w = bbox[2] * originalWidth;
    const h = bbox[3] * originalHeight;
    const x1 = cx - w / 2;
    const y1 = cy - h / 2;
    const x2 = cx + w / 2;
    const y2 = cy + h / 2;

    detections.push({
      x1,
      y1,
      x2,
      y2,
      confidence: maxScore,
      classIndex,
    });
  }

  // Perform non-max suppression to filter overlapping boxes
  const filteredDetections = nonMaxSuppression(detections, 0.5);

  // Track blocks that are assigned to a detection
  const assignedBlocks = new Set();

  let context = "";

  // Perform OCR on the detected regions
  for (const detection of filteredDetections) {
    const { x1, y1, x2, y2, classIndex } = detection;

    detection.backgroundColor = calculateMidpointColors(imageData, x1, y1, x2 - x1, y2 - y1);

    try {
      if (serviceSettings.ocrService === 'googleCloudVision') {
        const blocksInDetection = googleResults.blocks.filter(block => {
          if (assignedBlocks.has(block)) {
            return false; // Skip blocks that are already assigned
          }

          const blockBox = block.boundingBox;
          const blockCenterX = (blockBox[0].x + blockBox[2].x) / 2;
          const blockCenterY = (blockBox[0].y + blockBox[2].y) / 2;

          // Check if the block's center is within the detection's bounding box
          const isWithinDetection =
            blockCenterX >= x1 && blockCenterX <= x2 &&
            blockCenterY >= y1 && blockCenterY <= y2;

          if (isWithinDetection) {
            assignedBlocks.add(block); // Mark block as assigned
          }

          return isWithinDetection;
        });

        // Sort blocks by their vertical position (center Y)
        const sortedBlocks = blocksInDetection.sort((a, b) => {
          const aCenterY = (a.boundingBox[0].y + a.boundingBox[2].y) / 2;
          const bCenterY = (b.boundingBox[0].y + b.boundingBox[2].y) / 2;
          return aCenterY - bCenterY;
        });

        // Combine text from all blocks
        detection.text = sortedBlocks.map(block => block.text).join(' ') || '';
        detection.wordBoxes = sortedBlocks.map(block => block.wordBoxes).flat(1) || [];

        const totalFontSize = sortedBlocks.reduce((sum, block) => sum + block.fontSize, 0);
        detection.fontSize = sortedBlocks.length > 0 ? totalFontSize / sortedBlocks.length : 0;

      } else if (serviceSettings.ocrService === 'tesseract') {
        const w = x2 - x1;
        const h = y2 - y1;
        const subsection = cropCanvas(scaledCanvas, x1 * scaleFactor.x, y1 * scaleFactor.y, w * scaleFactor.x, h * scaleFactor.y);

        const ocrResults = await performTesseractOCR(subsection, classIndex, x1, y1, scaleFactor, detection.backgroundColor);
        detection.text = ocrResults.text.replace(/\n/g, ' ');
        detection.fontSize = ocrResults.fontSize || 0;
        detection.wordBoxes = ocrResults.wordBoxes || [];
      }

      if (detection.text) {
        console.log('Detected text:', detection.text);

        detection.translatedText = await translateText(detection.text, context, serviceSettings.sourceLanguage, serviceSettings.targetLanguage);
        context += detection.text + ' ';
        detection.translatedText = detection.translatedText.toUpperCase();

        console.log('Translated text:', detection.translatedText);
      } else {
        detection.translatedText = '';
      }

      renderDetection(canvas, detection);

    } catch (error) {
      console.error('Error processing detection:', error);
      detection.translatedText = detection.text || '';
    }
  }
  return { url: canvas.toDataURL(), detections: filteredDetections };
}

function renderDetection(canvas, detection) {
  const { x1, y1, x2, y2, translatedText, wordBoxes, backgroundColor } = detection;
  const boxWidth = x2 - x1; // Width of the bounding box
  const boxHeight = y2 - y1; // Height of the bounding box

  // Get the canvas context
  const ctx = canvas.getContext('2d');

  // ctx.strokeStyle = 'red'; // Set the outline color to red
  // ctx.lineWidth = 2; // Set the outline thickness
  // ctx.strokeRect(x1, y1, boxWidth, boxHeight);

  // Draw word bounding boxes
  if (wordBoxes && wordBoxes.length > 0) {
    ctx.fillStyle = `rgb(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b})` || 'rgb(255, 255, 255)';
    wordBoxes.forEach(word => {
      const [topLeft, topRight, bottomRight, bottomLeft] = word.boundingBox;

      // Calculate padding
      const padX = 0.1 * (topRight.x - topLeft.x); // 10% of the box width
      const padY = 0.1 * (bottomLeft.y - topLeft.y); // 10% of the box height

      // Adjust coordinates with padding
      const paddedTopLeft = {
        x: Math.max(x1, Math.min(x2, topLeft.x - padX)),
        y: Math.max(y1, Math.min(y2, topLeft.y - padY))
      };
      const paddedTopRight = {
        x: Math.max(x1, Math.min(x2, topRight.x + padX)),
        y: Math.max(y1, Math.min(y2, topRight.y - padY))
      };
      const paddedBottomRight = {
        x: Math.max(x1, Math.min(x2, bottomRight.x + padX)),
        y: Math.max(y1, Math.min(y2, bottomRight.y + padY))
      };
      const paddedBottomLeft = {
        x: Math.max(x1, Math.min(x2, bottomLeft.x - padX)),
        y: Math.max(y1, Math.min(y2, bottomLeft.y + padY))
      };

      // Draw the padded word box
      ctx.beginPath();
      ctx.moveTo(paddedTopLeft.x, paddedTopLeft.y);
      ctx.lineTo(paddedTopRight.x, paddedTopRight.y);
      ctx.lineTo(paddedBottomRight.x, paddedBottomRight.y);
      ctx.lineTo(paddedBottomLeft.x, paddedBottomLeft.y);
      ctx.closePath();
      ctx.fill();
    });
  }

  if (translatedText) {
    if (backgroundColor) {
      const gradient = ctx.createRadialGradient(
        x1 + boxWidth / 2, y1 + boxHeight / 2, 0, // Inner circle (center, radius 0)
        x1 + boxWidth / 2, y1 + boxHeight / 2, Math.max(boxWidth, boxHeight) / 2 // Outer circle (center, max radius)
      );

      gradient.addColorStop(0.8, `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, 1)`);
      gradient.addColorStop(1, `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, 0)`);

      // Draw the gradient over the bounding box
      ctx.fillStyle = gradient;
      ctx.fillRect(x1, y1, boxWidth, boxHeight);
    }

    const textX = (x1 + x2) / 2; // Center horizontally
    let fontSize = detection.fontSize; // Start with the initial font size
    const lineHeightFactor = 1.2; // Line height multiplier
    const maxHeight = boxHeight; // Maximum height of the bounding box
    const maxWidth = boxWidth; // Maximum width of the bounding box

    // Enhanced function to split text into lines that handles long words
    const splitTextIntoLines = (text, fontSize) => {
      ctx.font = `italic bold ${fontSize}px "CC Wild Words", "Comic Sans MS", Arial, sans-serif`;
      const words = text.split(' ');
      let currentLine = '';
      const resultLines = [];

      for (let i = 0; i < words.length; i++) {
        const word = words[i];

        // Check if a single word is too wide for the box
        if (ctx.measureText(word).width > maxWidth) return { lines: resultLines, success: false };

        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;

        if (testWidth > maxWidth) {
          resultLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      // Push the last line
      if (currentLine) {
        resultLines.push(currentLine);
      }

      return { lines: resultLines, success: true };
    };

    let lines = [];
    let lineHeight;

    // Adjust font size until the text fits within the bounding box
    while (fontSize >= 6) {
      const result = splitTextIntoLines(translatedText, fontSize);
      lines = result.lines;
      lineHeight = fontSize * lineHeightFactor;
      const totalTextHeight = lines.length * lineHeight;

      // Check if text fits both horizontally and vertically
      if (result.success && totalTextHeight <= maxHeight) {
        break;
      }

      fontSize -= 1; // Reduce font size
    }

    // Adjust the starting y-coordinate to center the text vertically
    const totalTextHeight = lines.length * lineHeight;
    const textY = y1 + (boxHeight - totalTextHeight) / 2;

    // Draw each line within the bounding box
    ctx.font = `italic bold ${fontSize}px "CC Wild Words", "Comic Sans MS", Arial, sans-serif`;
    ctx.fillStyle = 'black'; // Text fill color
    ctx.strokeStyle = 'white'; // Outline color
    ctx.lineWidth = 4; // Outline thickness
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    lines.forEach((line, index) => {
      const lineY = textY + index * lineHeight;
      ctx.strokeText(line, textX, lineY);
      ctx.fillText(line, textX, lineY);
    });
  }
}