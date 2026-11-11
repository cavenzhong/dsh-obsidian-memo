/** 按条目和字节预算约束的缩略图 LRU。 */
import { IMAGE_CACHE_BUDGET, IMAGE_CACHE_MAX } from '../constants.js';

const imageCache = new Map();

let imageCacheTotalBytes = 0;

function imageCacheKey(path, source) {
  return String(path == null ? '' : path) + '\u0000' + String(source == null ? '' : source);
}

function imageCacheBytes() {
  return imageCacheTotalBytes;
}

function imageCacheSize() {
  return imageCache.size;
}

function evictImageCacheKey(key) {
  const entry = imageCache.get(key);
  if (!entry) return;
  imageCache.delete(key);
  imageCacheTotalBytes -= entry.bytes;
  if (imageCacheTotalBytes < 0) imageCacheTotalBytes = 0;
}

function readImageCache(key) {
  if (!imageCache.has(key)) return '';
  const entry = imageCache.get(key);
  imageCache.delete(key);
  imageCache.set(key, entry); // 命中后移到队尾（最近使用）
  return entry.dataUrl;
}

function writeImageCache(key, dataUrl) {
  if (!key || typeof dataUrl !== 'string' || dataUrl === '') return;
  if (imageCache.has(key)) evictImageCacheKey(key);
  const bytes = dataUrl.length;
  imageCache.set(key, { dataUrl: dataUrl, bytes: bytes });
  imageCacheTotalBytes += bytes;
  // 先按字节预算淘汰最旧条目，再用条目上限兜底。
  while (imageCache.size > 0 && (imageCacheTotalBytes > IMAGE_CACHE_BUDGET || imageCache.size > IMAGE_CACHE_MAX)) {
    const oldest = imageCache.keys().next();
    if (oldest.done) break;
    evictImageCacheKey(oldest.value);
  }
}

function clearImageCache() {
  imageCache.clear();
  imageCacheTotalBytes = 0;
}

export { imageCacheKey, imageCacheBytes, imageCacheSize, readImageCache, writeImageCache, clearImageCache };
