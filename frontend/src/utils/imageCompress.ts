/**
 * Client-side image compression for FieldGovern.
 *
 * Compresses photos BEFORE uploading to save bandwidth on 2G networks.
 * Uses Canvas API (works in all modern browsers including mobile).
 *
 * Pipeline:
 *   1. data:image/... URI → Image element
 *   2. Resize to max 1280px (longest side)
 *   3. Draw onto Canvas
 *   4. Export as JPEG at quality 0.7
 *   5. Result is typically 50-150KB (vs 2-5MB raw camera photo)
 */

const MAX_DIMENSION = 1280; // px — enough for field data, small file
const JPEG_QUALITY = 0.7;
const MAX_TARGET_KB = 200; // soft target

/**
 * Compress a data URI image to a smaller JPEG data URI.
 * Returns the compressed data URI and its approximate byte size.
 */
export async function compressImage(
  dataUri: string,
  maxDimension = MAX_DIMENSION,
  quality = JPEG_QUALITY,
): Promise<{ dataUri: string; sizeKB: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;

        // Scale down if needed
        if (Math.max(width, height) > maxDimension) {
          const ratio = maxDimension / Math.max(width, height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Draw on canvas
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ dataUri, sizeKB: dataUri.length * 0.75 / 1024 });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG
        let compressed = canvas.toDataURL("image/jpeg", quality);
        let sizeKB = compressed.length * 0.75 / 1024; // base64 → bytes approx

        // If still too large, reduce quality
        let q = quality;
        while (sizeKB > MAX_TARGET_KB && q > 0.3) {
          q -= 0.1;
          compressed = canvas.toDataURL("image/jpeg", q);
          sizeKB = compressed.length * 0.75 / 1024;
        }

        console.log(
          `[ImageCompress] ${img.naturalWidth}x${img.naturalHeight} → ${width}x${height}, ` +
          `${sizeKB.toFixed(0)}KB (q=${q.toFixed(1)})`
        );

        resolve({ dataUri: compressed, sizeKB });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      // Can't compress — return original
      resolve({ dataUri, sizeKB: dataUri.length * 0.75 / 1024 });
    };
    img.src = dataUri;
  });
}

/**
 * Compress a data URI and return as Blob (for FormData upload).
 */
export async function compressImageToBlob(
  dataUri: string,
  maxDimension = MAX_DIMENSION,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  const { dataUri: compressed } = await compressImage(dataUri, maxDimension, quality);
  return dataUriToBlob(compressed);
}

/**
 * Convert a data URI to a Blob.
 */
export function dataUriToBlob(dataUri: string): Blob {
  const [header, base64] = dataUri.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
