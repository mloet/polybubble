export async function base64ToCanvas(base64Image) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = base64Image;
  });
}

export function resizeCanvas(canvas, newWidth, newHeight) {
  const newCanvas = document.createElement('canvas');
  newCanvas.width = newWidth;
  newCanvas.height = newHeight;
  const newCtx = newCanvas.getContext('2d');
  newCtx.imageSmoothingEnabled = true;
  newCtx.imageSmoothingQuality = 'high';
  newCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

  return newCanvas;
}

export function cropCanvas(canvas, x, y, width, height) {
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = width;
  croppedCanvas.height = height;
  const croppedCtx = croppedCanvas.getContext('2d');
  croppedCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);

  return croppedCanvas;
}

export function calculateMidpointColors(imageData, x1, y1, width, height, threshold = 30) {
  const { data, width: imageWidth } = imageData;

  // Helper function to get color at a specific pixel
  function getColorAt(x, y) {
    const index = (Math.floor(y) * imageWidth + Math.floor(x)) * 4;
    return {
      r: data[index],
      g: data[index + 1],
      b: data[index + 2]
    };
  }

  const offset = Math.min(width, height) * 0.025;

  // Calculate midpoints with offsets
  const midpoints = [
    { x: x1 + width / 2, y: y1 + offset }, // Top edge midpoint
    { x: x1 + width / 2, y: y1 + height - offset }, // Bottom edge midpoint
    { x: x1 + offset, y: y1 + height / 2 }, // Left edge midpoint
    { x: x1 + width - offset, y: y1 + height / 2 } // Right edge midpoint
  ];

  // Sample colors at the midpoints
  const colors = midpoints.map(({ x, y }) => getColorAt(x, y));

  // Average the colors
  const averageColor = colors.reduce(
    (acc, color) => {
      acc.r += color.r;
      acc.g += color.g;
      acc.b += color.b;
      return acc;
    },
    { r: 0, g: 0, b: 0 }
  );

  const numColors = colors.length;
  const avgColor = {
    r: Math.round(averageColor.r / numColors),
    g: Math.round(averageColor.g / numColors),
    b: Math.round(averageColor.b / numColors)
  };

  // Check if the average color is close to black or white
  const isCloseToBlack = avgColor.r <= threshold && avgColor.g <= threshold && avgColor.b <= threshold;
  const isCloseToWhite = avgColor.r >= 255 - threshold && avgColor.g >= 255 - threshold && avgColor.b >= 255 - threshold;

  if (isCloseToBlack) {
    return { r: 0, g: 0, b: 0 }; // Black
  } else if (isCloseToWhite) {
    return { r: 255, g: 255, b: 255 }; // White
  }

  return avgColor; // Return the calculated average color
}

export function calculateIoU(box1, box2) {
  const x1 = Math.max(box1.x1, box2.x1);
  const y1 = Math.max(box1.y1, box2.y1);
  const x2 = Math.min(box1.x2, box2.x2);
  const y2 = Math.min(box1.y2, box2.y2);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const box1Area = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
  const box2Area = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);

  return intersection / (box1Area + box2Area - intersection);
}

export function nonMaxSuppression(detections, iouThreshold) {
  detections.sort((a, b) => b.confidence - a.confidence);
  const finalDetections = [];

  while (detections.length > 0) {
    const best = detections.shift();
    finalDetections.push(best);
    detections = detections.filter(box => calculateIoU(best, box) < iouThreshold);
  }

  return finalDetections;
}

export function applyEllipticalGradientMask(canvas, backgroundColor) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;

  // Create a radial gradient centered in the middle of the canvas
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0, // Inner circle (center, radius 0)
    width / 2, height / 2, 1.2 * Math.max(width, height) / 2 // Outer circle (center, max radius)
  );

  // Add color stops: fully visible in the center, fading to the background color at the edges
  gradient.addColorStop(0.8, `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, 0)`);
  gradient.addColorStop(1, `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, 1)`); // Background color at the edges

  // Draw the gradient over the canvas
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

// export function applyEllipticalGradientMask(canvas) {
//   const ctx = canvas.getContext('2d');
//   const { width, height } = canvas;

//   // Create an offscreen canvas to apply the blur effect
//   const offscreenCanvas = document.createElement('canvas');
//   offscreenCanvas.width = width;
//   offscreenCanvas.height = height;
//   const offscreenCtx = offscreenCanvas.getContext('2d');

//   // Draw the original canvas content onto the offscreen canvas
//   offscreenCtx.drawImage(canvas, 0, 0);

//   // Apply a radial gradient mask to control the blur intensity
//   const gradient = offscreenCtx.createRadialGradient(
//     width / 2, height / 2, 0, // Inner circle (center, radius 0)
//     width / 2, height / 2, Math.max(width, height) / 2 // Outer circle (center, max radius)
//   );

//   // Add color stops: no blur in the center, increasing blur at the edges
//   gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0)'); // No blur from 80% in
//   gradient.addColorStop(1, 'rgba(255, 255, 255, 1)'); // Full blur at the edges

//   // Fill the gradient mask
//   offscreenCtx.fillStyle = gradient;
//   offscreenCtx.fillRect(0, 0, width, height);

//   // Apply the blur filter
//   ctx.filter = 'blur(10px)'; // Adjust the blur intensity as needed
//   ctx.drawImage(offscreenCanvas, 0, 0);
// }

// export function applyEllipticalBlur(canvas, x, y, width, height) {
//   const ctx = canvas.getContext('2d');

//   // Create an offscreen canvas to apply the blur effect
//   const offscreenCanvas = document.createElement('canvas');
//   offscreenCanvas.width = width;
//   offscreenCanvas.height = height;
//   const offscreenCtx = offscreenCanvas.getContext('2d');

//   // Draw the original canvas content onto the offscreen canvas
//   offscreenCtx.drawImage(canvas, 0, 0);

//   // Apply a radial gradient mask to control the blur intensity
//   const gradient = ctx.createRadialGradient(
//     x + width / 2, y + height / 2, 0, // Inner circle (center, radius 0)
//     x + width / 2, y + height / 2, Math.max(width, height) / 2 // Outer circle (center, max radius)
//   );

//   // Add color stops: no blur in the center, increasing blur at the edges
//   gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)'); // No blur in the center
//   gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Full blur at the edges

//   // Apply the gradient as a mask
//   ctx.filter = 'blur(20px)'; // Adjust the blur intensity as needed
//   ctx.drawImage(offscreenCanvas, 0, 0);
// }

// export function applyEllipticalBlur(canvas, x, y, width, height) {
//   const ctx = canvas.getContext('2d');
//   ctx.save();

//   // Create an offscreen canvas for the blurred version
//   const offscreenCanvas = document.createElement('canvas');
//   offscreenCanvas.width = canvas.width;  // Use full canvas dimensions
//   offscreenCanvas.height = canvas.height;
//   const offscreenCtx = offscreenCanvas.getContext('2d');

//   // Draw the original content
//   offscreenCtx.drawImage(canvas, 0, 0);

//   // Apply blur to the offscreen canvas
//   offscreenCtx.filter = 'blur(20px)';
//   offscreenCtx.drawImage(canvas, 0, 0);

//   // Create a gradient for masking
//   const gradient = ctx.createRadialGradient(
//     x + width / 2, y + height / 2, 0,           // Inner circle center
//     x + width / 2, y + height / 2, width / 2      // Outer circle center and radius
//   );

//   // Define gradient stops
//   gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');      // Center: fully blurred
//   gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');  // Mid: partially blurred
//   gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');      // Edge: no blur

//   // Draw the blurred version
//   ctx.drawImage(offscreenCanvas, 0, 0);

//   // Apply the gradient mask
//   ctx.globalCompositeOperation = 'destination-in';
//   ctx.fillStyle = gradient;
//   ctx.fillRect(x, y, width, height);
//   ctx.restore();
// }

export function applyEllipticalBlur(canvas, x, y, w, h, blur) {
  const ctx = canvas.getContext('2d');
  // Save the current canvas state
  ctx.save();

  // Apply blur filter
  ctx.filter = `blur(${blur}px)`;

  // Draw the ellipse
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Restore the canvas state (removes the blur filter)
  ctx.restore();
}

export function imageDataToDataURL(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

