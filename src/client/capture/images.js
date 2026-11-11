/** 图片数量/大小校验、读取与 WebP 编码；不发送 RPC。 */
import {
  CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_SOURCE_IMAGE_BYTES, CAPTURE_SOURCE_TOTAL_BYTES,
  CAPTURE_TOTAL_BYTES,
} from '../constants.js';
import { makeError } from '../utils.js';

function readImageCompression(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const number = (value, fallback, min, max) => typeof value !== 'number' || !Number.isFinite(value)
    ? fallback : Math.min(max, Math.max(min, Math.round(value)));
  return { enabled: source.enabled !== false, quality: number(source.quality, 70, 1, 100), maxDimension: number(source.maxDimension, 2048, 256, 8192) };
}

function captureImageSize(width, height, maxDimension) {
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

async function compressCaptureImage(file, options) {
  const config = readImageCompression(options);
  if (!config.enabled) return file;
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid dimensions');
    const size = captureImageSize(image.naturalWidth, image.naturalHeight, config.maxDimension);
    canvas.width = size.width; canvas.height = size.height;
    canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', config.quality / 100));
    if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding unavailable');
    return blob;
  } catch {
    throw makeError('bad-request', 'capture.compressFailed');
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0; canvas.height = 0;
  }
}

function captureFiles(existing, files, compression) {
  const next = Array.from(files || []);
  if (next.some((file) => !/^image\/(png|jpeg|gif|webp)$/.test(file.type))) return 'capture.imageType';
  const compress = readImageCompression(compression).enabled;
  const [maxImageBytes, maxTotalBytes] = compress
    ? [CAPTURE_SOURCE_IMAGE_BYTES, CAPTURE_SOURCE_TOTAL_BYTES]
    : [CAPTURE_IMAGE_BYTES, CAPTURE_TOTAL_BYTES];
  if (existing.length + next.length > CAPTURE_IMAGES || next.some((file) => file.size > maxImageBytes)
    || existing.concat(next).reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) return compress ? 'capture.sourceLimit' : 'capture.imageLimit';
  return '';
}

function readCaptureImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result });
    reader.onerror = reader.onabort = () => reject(makeError('bad-request', 'capture.readFailed'));
    reader.readAsDataURL(file);
  });
}

export { readImageCompression, captureImageSize, compressCaptureImage, captureFiles, readCaptureImage };
