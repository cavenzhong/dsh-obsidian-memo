/** 快速记录：先保存附件，最后以独占方式发布 Markdown，任何失败都回收本次附件。 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { formatTemplateMoment } from './datetime.js'
import { assertPathWithin, failure, isHiddenVaultPath, moveFileExclusive, readNoteFile } from './files.js'
import { DEFAULT_FILE_NAME_PATTERN, buildCaptureFileName, sanitizeNoteFileName, truncateNoteName } from './filename.js'
import { formatBytes, LIMITS } from './shared.js'
import { splitFrontmatter } from './notes.js'
import { DEFAULT_TITLE_MODE, normalizeTitleMode, sanitizeTitleText, titleLineFor } from './title.js'

// 0.16.7 及以前从 capture 导出；0.16.8 迁到 datetime.js 后继续 re-export，保持旧 import 不变。
export { formatTemplateMoment } from './datetime.js'

/** 替换 Default Template 在整份模板里会替换的三个变量（这里只作用于 frontmatter）。 */
export function expandTemplateVariables(text, title, now = new Date()) {
  // 与 Default Template 的替换顺序一致：date → time → title（title 里即使出现占位符也不再展开）。
  return text
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_, format) => formatTemplateMoment(now, format ?? 'YYYY-MM-DD'))
    .replace(/\{\{time(?::([^}]+))?\}\}/g, (_, format) => formatTemplateMoment(now, format ?? 'HH:mm'))
    .replace(/\{\{title\}\}/g, () => title)
}

/** 模板只是增强项：配置损坏、模板不可读或越界都按「无模板」继续，绝不阻塞新建。 */
async function captureFrontmatter(vault, notes, title, fileStem, now) {
  try {
    return await readTemplateFrontmatter(vault, notes, title, fileStem, now)
  } catch {
    return null
  }
}

/** 只读 Default Template 的文件夹映射；新建时直接附上模板 meta，不依赖 Obsidian 的空文件事件。 */
async function readTemplateFrontmatter(vault, notes, title, fileStem, now) {
  async function configAt(relativePath) {
    const path = join(vault, relativePath)
    await assertPathWithin(vault, path, { allowMissing: true })
    try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return null
      throw failure('fs-failed', `无法读取新建便签的模板配置：${relativePath}`, error)
    }
  }
  const config = await configAt('.obsidian/plugins/default-template/data.json')
  if (!config || typeof config !== 'object') return null
  // 保守判断：community-plugins.json 缺失/损坏/非数组都视为插件未启用，避免误套模板。
  const enabled = await configAt('.obsidian/community-plugins.json')
  if (!Array.isArray(enabled) || !enabled.includes('default-template')) return null
  const folder = relative(vault, notes).split(sep).join('/')
  const path = `${folder ? `${folder}/` : ''}${fileStem}.md`
  const normalize = (value) => String(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const matches = (prefix) => prefix && (path === prefix || path.startsWith(`${prefix}/`))
  if (Array.isArray(config.ignorePaths) && config.ignorePaths.some((item) => typeof item === 'string' && matches(normalize(item)))) return null
  const candidates = Object.entries(config.folderTemplates || {})
    .filter(([key, value]) => typeof value === 'string' && matches(normalize(key)))
    .sort(([a], [b]) => b.length - a.length).map(([, value]) => value)
  if (typeof config.defaultTemplate === 'string' && config.defaultTemplate) candidates.push(config.defaultTemplate)
  for (const candidate of candidates) {
    const template = resolve(vault, candidate)
    await assertPathWithin(vault, template, { allowMissing: true })
    const info = await stat(template).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
    if (!info?.isFile()) continue
    if (extname(template).toLowerCase() !== '.md') throw failure('bad-request', '新建便签模板必须是 Markdown 文件')
    const frontmatter = splitFrontmatter(await readNoteFile(template)).frontmatter
    return frontmatter === null ? null : expandTemplateVariables(frontmatter, title, now)
  }
  return null
}

function imageBytes(image) {
  const match = typeof image?.dataUrl === 'string' && image.dataUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match || match[2].length % 4 !== 0) throw failure('bad-request', '请选择 PNG、JPEG、GIF 或 WebP 图片')
  if (match[2].length > Math.ceil(LIMITS.captureImageBytes / 3) * 4) throw failure('too-large', `单张图片不能超过 ${formatBytes(LIMITS.captureImageBytes)}`)
  const bytes = Buffer.from(match[2], 'base64')
  const type = match[1]
  const valid = type === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : type === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : type === 'gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid) throw failure('bad-request', '图片格式与内容不一致')
  if (bytes.length > LIMITS.captureImageBytes) throw failure('too-large', `单张图片不能超过 ${formatBytes(LIMITS.captureImageBytes)}`)
  return { bytes, ext: type === 'jpeg' ? 'jpg' : type }
}

/** 正文模式的重名后缀：保证 base + `-N` 仍在 240 字节内。 */
function suffixName(base, index) {
  const suffix = `-${index}`
  return `${truncateNoteName(base, LIMITS.noteNameBytes - Buffer.byteLength(suffix, 'utf8'))}${suffix}`
}

export async function createCapturedNote({
  vault, notes, targetDir: configuredTargetDir = '', attachmentDir: configuredAttachmentDir = '',
  titleMode = DEFAULT_TITLE_MODE, fileNamePattern = DEFAULT_FILE_NAME_PATTERN, now = new Date(),
}, payload) {
  if (typeof payload?.title !== 'string' || typeof payload?.body !== 'string') throw failure('bad-request', '缺少想法或正文')
  const mode = normalizeTitleMode(titleMode)
  let title
  let fileStem
  if (mode === 'filename') {
    const titleCheck = sanitizeNoteFileName(payload.title)
    if (titleCheck.error === 'too-long') throw failure('bad-request', '想法过长，请缩短文件名，按 Tab 将细节放入正文')
    if (titleCheck.error !== null) throw failure('bad-request', '请输入可用的便签文件名')
    title = titleCheck.name
    fileStem = title
  } else {
    // 正文模式：标题是正文文字，不做文件名长度/字符校验；文件名由模板生成。
    title = sanitizeTitleText(payload.title)
    if (title === '') throw failure('bad-request', '请输入便签标题')
    fileStem = buildCaptureFileName(fileNamePattern, { title, now })
  }
  const images = payload.images === undefined ? [] : payload.images
  if (!Array.isArray(images) || images.length > LIMITS.captureImages) throw failure('bad-request', `每篇便签最多添加 ${LIMITS.captureImages} 张图片`)
  const decoded = images.map(imageBytes)
  if (decoded.reduce((sum, image) => sum + image.bytes.length, 0) > LIMITS.captureTotalBytes) throw failure('too-large', `图片合计不能超过 ${formatBytes(LIMITS.captureTotalBytes)}`)
  const actualVault = await assertPathWithin(vault, vault)
  const actualNotes = await assertPathWithin(vault, notes)
  // 0.18 工作空间：新建便签可落到便签目录内已存在的工作空间子文件夹。
  // 工作空间可以挂载仓库内任意可见文件夹：目标以仓库为边界；没有目标时仍落在默认便签目录。
  const actualTarget = configuredTargetDir ? await assertPathWithin(vault, configuredTargetDir) : actualNotes
  // 返回给扫描缓存/调用方的路径沿用配置里的写法（不经 realpath），与其他便签路径一致。
  const targetBase = configuredTargetDir || notes
  let target = join(actualTarget, `${fileStem}.md`)
  await assertPathWithin(actualTarget, target, { allowMissing: true })
  const attachmentRoot = configuredAttachmentDir ? vault : actualNotes
  let attachmentDir = configuredAttachmentDir ? resolve(vault, configuredAttachmentDir) : join(actualNotes, '_attachments')
  if (decoded.length) {
    attachmentDir = await assertPathWithin(attachmentRoot, attachmentDir, { allowMissing: true })
    // 只限制用户显式配置的图片文件夹；默认的 notesDir/_attachments 跟随便签目录，不额外加规则。
    if (configuredAttachmentDir && isHiddenVaultPath(actualVault, attachmentDir)) {
      throw failure('bad-request', '图片文件夹不能位于仓库的隐藏目录（Obsidian 不索引以 . 开头的目录）')
    }
    await mkdir(attachmentDir, { recursive: true })
    await assertPathWithin(configuredAttachmentDir ? actualVault : actualNotes, attachmentDir)
  }
  const attachments = decoded.map((image) => ({ ...image, name: `${randomUUID()}.${image.ext}` }))
  // Default Template 按第一次选定的文件名匹配；碰撞重试只换目标名，不重新解析模板。
  const frontmatter = await captureFrontmatter(actualVault, actualTarget, title, fileStem, now)
  const body = payload.body.replace(/\r\n?/g, '\n').trim()
  // 使用仓库相对 wikilink，便签归档到其他文件夹后图片仍可解析。
  const embeds = attachments.map((image) => `![[${relative(actualVault, join(attachmentDir, image.name)).split(sep).join('/')}]]`).join('\n\n')
  const titleLine = titleLineFor(mode, title)
  const content = [frontmatter, titleLine, body, embeds].filter(Boolean).join('\n\n')
  const text = content ? `${content}\n` : ''
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxFileBytes) throw failure('too-large', '便签正文过大')
  const written = []
  const temp = join(actualTarget, `.${randomUUID()}.tmp`)
  let published = false
  const attempts = mode === 'filename' ? 1 : 5
  try {
    for (const image of attachments) {
      const path = join(attachmentDir, image.name)
      const handle = await open(path, 'wx')
      written.push(path)
      try { await handle.writeFile(image.bytes) } finally { await handle.close() }
    }
    await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' })
    let publishedName = ''
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = attempt === 0 ? fileStem : suffixName(fileStem, attempt + 1)
      target = join(actualTarget, `${candidate}.md`)
      await assertPathWithin(actualTarget, target, { allowMissing: true })
      try {
        await moveFileExclusive(temp, target) // 不覆盖重名文件；并发创建也只允许一个成功。
        publishedName = candidate
        break
      } catch (error) {
        if (error.code !== 'EEXIST' || mode === 'filename') throw error
      }
    }
    if (publishedName === '') throw failure('exists', '同名便签已存在，请稍后重试')
    published = true
    return join(targetBase, `${publishedName}.md`)
  } catch (error) {
    if (error.code === 'EEXIST') throw failure('exists', mode === 'filename' ? `同名便签已存在：${fileStem}` : '同名便签已存在，请稍后重试')
    throw error
  } finally {
    await unlink(temp).catch(() => {})
    if (!published) await Promise.all(written.map((path) => unlink(path)))
  }
}
