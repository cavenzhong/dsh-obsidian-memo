/** 本地图片读取；持有附件路径缓存和限时负缓存。 */
import { assertPathWithin, failure, isInside } from '../files.js'
import { formatBytes } from '../shared.js'
import { debugLog, now } from './environment.js'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

function createImageReader({ assertNotePath, requireNotes }) {
  const DEFAULT_IMAGE_MAX_BYTES = 8 * 1024 * 1024

  const IMAGE_PATH_CACHE_LIMIT = 500

  const IMAGE_MISS_TTL_MS = 60 * 1000

  function imageMaxBytes(value) {
    const requested = Number(value)
    if (!Number.isFinite(requested) || requested <= 0) return null
    return Math.floor(requested)
  }

  const imagePaths = new Map()

  const imageMisses = new Map()

  function rememberImagePath(key, actual) {
    if (imagePaths.size >= IMAGE_PATH_CACHE_LIMIT) {
      const oldest = imagePaths.keys().next().value
      if (oldest !== undefined) imagePaths.delete(oldest)
    }
    imagePaths.set(key, actual)
  }

  function rememberImageMiss(key) {
    if (imageMisses.size >= IMAGE_PATH_CACHE_LIMIT) {
      const oldest = imageMisses.keys().next().value
      if (oldest !== undefined) imageMisses.delete(oldest)
    }
    imageMisses.set(key, now() + IMAGE_MISS_TTL_MS)
  }

  async function endpointReadImage(payload) {
    const startedAt = performance.now()
    const notePath = await assertNotePath(payload?.path)
    const wiki = payload?.wiki === true
    let source = typeof payload?.source === 'string' ? payload.source.trim() : ''
    try { source = decodeURIComponent(source) } catch { throw failure('bad-request', '图片路径编码无效') }
    if (!source || source.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(source)) throw failure('bad-request', '本地图片路径无效')
    const paths = requireNotes()
    const imagePath = resolve(dirname(notePath), source)
    if (!isInside(paths.vault, imagePath)) throw failure('bad-request', '图片不在 Obsidian 仓库内')

    // 附件名解析（尤其 wiki 裸文件名）要遍历全库；命中与落空都缓存，避免反复 walk。
    // 命中缓存用 realpath 复核，文件被移动/删除就失效重算。
    const cacheKey = `${notePath}\u0000${source}\u0000${wiki ? '1' : '0'}`
    const cached = imagePaths.get(cacheKey)
    let actual = cached === undefined ? null : await realpath(cached).catch(() => null)
    if (cached !== undefined && actual === null) imagePaths.delete(cacheKey)
    if (actual === null) {
      // 负缓存：60s 内同一附件名不再全库查找（wiki 裸附件名找到不存在的图时最贵）。
      const missExpires = imageMisses.get(cacheKey)
      if (missExpires !== undefined) {
        if (missExpires > now()) {
          debugLog(`readImage · not-found · negative-cache · ${(performance.now() - startedAt).toFixed(1)}ms`)
          throw failure('not-found', '找不到本地图片')
        }
        imageMisses.delete(cacheKey)
      }
    }
    if (actual === null) {
      try { actual = await realpath(imagePath) } catch {
        try { actual = await realpath(resolve(paths.vault, source)) } catch { /* 继续查找 Obsidian 附件 */ }
      }
    }
    if (actual === null && wiki) {
      debugLog('readImage · walk vault attachments')
      const matches = []
      let visited = 0
      async function walk(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (++visited > 20000) throw failure('bad-request', '附件查找范围过大，请使用仓库相对路径')
          if (entry.name.startsWith('.') || entry.isSymbolicLink() || entry.name === 'node_modules') continue
          const candidate = join(dir, entry.name)
          if (entry.isDirectory()) await walk(candidate)
          else if (entry.isFile() && (relative(paths.vault, candidate).split(sep).join('/') === source || (source.indexOf('/') < 0 && entry.name === source))) matches.push(candidate)
        }
      }
      await walk(paths.vault)
      if (matches.length > 1) throw failure('bad-request', '有多个同名附件，请使用仓库相对路径')
      if (matches.length === 1) actual = await realpath(matches[0]).catch(() => null)
    }
    if (actual === null) {
      if (wiki) rememberImageMiss(cacheKey)
      debugLog(`readImage · not-found · ${(performance.now() - startedAt).toFixed(1)}ms`)
      throw failure('not-found', '找不到本地图片')
    }
    await assertPathWithin(await realpath(paths.vault), actual)
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' })[extname(actual).toLowerCase()]
    if (!mime) throw failure('bad-request', '不支持这种图片格式')
    const info = await stat(actual)
    if (!info.isFile()) throw failure('bad-request', '本地图片不是文件')
    // 默认上限 8 MB；卡片缩略图显式传 maxBytes 时按传入值判定。超过统一报 too-large。
    const maxBytes = imageMaxBytes(payload?.maxBytes) ?? DEFAULT_IMAGE_MAX_BYTES
    if (info.size > maxBytes) throw failure('too-large', `本地图片超过读取上限（${formatBytes(maxBytes)}）`)
    const data = await readFile(actual)
    imageMisses.delete(cacheKey)
    rememberImagePath(cacheKey, actual)
    debugLog(`readImage ${(performance.now() - startedAt).toFixed(1)}ms · ${data.length} bytes · ${cached !== undefined ? 'path-cache' : 'resolve'}`)
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}` }
  }

  function clearImagePaths() { imagePaths.clear(); imageMisses.clear() }

  return { endpointReadImage, clearImagePaths }
}

export { createImageReader }
