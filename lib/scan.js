/**
 * dsh-obsidian-memo —— 默认工作空间 + 挂载工作空间的便签扫描与缓存。
 *
 * 轮询式刷新（Obsidian 保存后数秒内反映），不注册文件监听、不占用文件锁。
 * 每次 scan 只 stat 文件；内容仅在 mtime/size 变化时重读重解析。
 * @module dsh-obsidian-memo/scan
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { archiveFolderExclusion } from './archive-folders.js'
import { commentGroupsFrom } from './comments.js'
import { LIMITS, colorForTag, darkColorForTag } from './shared.js'
import { assertPathWithin, contentRevision, isHiddenVaultPath, isInside, readNoteFile } from './files.js'
import {
  clip, commentKindsFrom, getBody, parseNote, summarizeImages, tagForRelativePath,
} from './notes.js'
import { DEFAULT_TITLE_MODE, normalizeTitleMode } from './title.js'

const SKIP_DIRS = new Set(['node_modules', '__MACOSX', '.trash', '.obsidian'])
const UNCONFIGURED = 'unconfigured'
// 全文只为当前阅读服务；不要为整库长期保留正文、blocks 和全部评论。
const FULL_CACHE_LIMIT = 4

function fileSignature(info) {
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}:${info.birthtimeMs}`
}

/** 是否是可以进入的目录项。 */
function walkable(dirent) {
  if (!dirent.isDirectory()) return false
  if (dirent.name.startsWith('.')) return false
  if (SKIP_DIRS.has(dirent.name)) return false
  return true
}

/** 收集活动 Markdown；根目录本身和任意后代都走同一份归档排除规则。 */
async function collectMarkdown(root, actual, depth, output, recursive, excludeArchive) {
  if (excludeArchive(root, actual)) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const dirent of entries) {
    if (dirent.isSymbolicLink()) continue
    const absolute = join(root, dirent.name)
    if (dirent.isDirectory()) {
      if (!recursive || depth >= LIMITS.maxDepth || !walkable(dirent)) continue
      await collectMarkdown(absolute, join(actual, dirent.name), depth + 1, output, recursive, excludeArchive)
      continue
    }
    if (!dirent.isFile()) continue
    if (dirent.name.startsWith('.')) continue
    if (!dirent.name.toLowerCase().endsWith('.md')) continue
    output.push(absolute)
  }
}

/**
 * 工作空间根：客户端传仓库相对路径，Host 只接受仓库内、可见、真实存在的目录。
 * 「主空间」的 notesDir 始终单独扫描；这里返回其余根（按客户端顺序，去重）。
 */
async function workspaceRoots(vaultPath, notesDir, workspacePaths, excludeArchive) {
  const roots = []
  const seen = new Set()
  for (const value of Array.isArray(workspacePaths) ? workspacePaths.slice(0, 24) : []) {
    if (typeof value !== 'string') continue
    const clean = value.replace(/\\/g, '/').trim()
    if (clean === '' || clean === '.') continue
    const parts = clean.split('/').filter((part) => part !== '' && part !== '.')
    if (parts.length === 0) continue
    if (parts.some((part) => part === '..' || part.startsWith('.'))) continue
    const absolute = join(vaultPath, ...parts)
    if (!isInside(vaultPath, absolute) || isHiddenVaultPath(vaultPath, absolute)) continue
    if (seen.has(absolute) || absolute === notesDir) continue
    try {
      const actual = await assertPathWithin(vaultPath, absolute)
      if (excludeArchive(absolute, actual)) continue
      const info = await stat(actual)
      if (!info.isDirectory()) continue
      roots.push({ root: absolute, actual, recursive: true })
    } catch {
      continue
    }
    seen.add(absolute)
  }
  return roots
}

/** 一条便签的缓存记录。 */
function buildSummary(entry, parsed, titleMode) {
  return {
    path: entry.path,
    relPath: entry.relPath,
    name: entry.name,
    // filename 模式仍是文件名；正文模式用派生标题，展示上限 LIMITS.titleChars。
    title: titleMode === 'filename' ? entry.name : (clip(parsed.title, LIMITS.titleChars) || entry.name),
    excerpt: parsed.excerpt,
    cardPreview: parsed.cardPreview,
    projects: parsed.projects,
    tag: entry.tag,
    color: entry.color,
    darkColor: entry.darkColor,
    comments: parsed.comments.slice(0, LIMITS.summaryComments).map((comment) => ({
      type: comment.type,
      emoji: comment.emoji,
      label: comment.label,
      title: comment.title,
      time: comment.time,
      text: clip(comment.text, 500),
    })),
    commentCount: parsed.comments.length,
    commentGroups: commentGroupsFrom(parsed.comments),
    ...summarizeImages(parsed.blocks),
    commentKinds: commentKindsFrom(parsed.comments),
    created: entry.created,
    mtime: entry.mtime,
    size: entry.size,
  }
}

export class NotesScanner {
  constructor() {
    /** @type {Map<string, object>} */
    this.entries = new Map()
    this.fullNotes = new Map()
    this.revision = UNCONFIGURED
    this.scanKey = ''
    this.titleMode = DEFAULT_TITLE_MODE
  }

  /** 清空全部缓存（设置变化时）。 */
  reset() {
    this.entries.clear()
    this.fullNotes.clear()
    this.revision = UNCONFIGURED
    this.scanKey = ''
    this.titleMode = DEFAULT_TITLE_MODE
  }

  /** 丢弃单个文件的缓存（写入后）。 */
  invalidate(filePath) {
    this.entries.delete(filePath)
    this.fullNotes.delete(filePath)
  }

  /**
   * 扫描一次。
   * @param {{ vaultPath: string, notesDir: string }} settings
   * @param {string[]} [workspacePaths] - 已挂载工作空间的仓库相对路径
   * @returns {Promise<{ configured: boolean, error: string | null, revision: string, notes: object[] }>}
   */
  async scan(settings, workspacePaths = []) {
    const notesDir = settings?.notesDir ?? ''
    const vaultPath = settings?.vaultPath ?? ''
    const includeSubfolders = settings?.includeSubfolders !== false
    const archiveMode = settings?.archiveMode === 'mapped' ? 'mapped' : 'local'
    const archiveFolderName = typeof settings?.archiveFolderName === 'string' ? settings.archiveFolderName : '归档'
    const titleMode = normalizeTitleMode(settings?.titleMode)
    const archiveDir = archiveMode === 'mapped' ? settings?.archiveDir || '' : ''
    this.projectKey = settings?.projectKey || 'PROJECT'
    this.titleMode = titleMode
    if (!notesDir || !vaultPath) {
      this.reset()
      return { configured: false, error: null, revision: UNCONFIGURED, notes: [] }
    }
    let plans, excludeArchive
    try {
      const actual = await assertPathWithin(vaultPath, notesDir)
      const info = await stat(actual)
      if (!info.isDirectory()) {
        return { configured: false, error: `默认工作空间不是文件夹：${notesDir}`, revision: UNCONFIGURED, notes: [] }
      }
      excludeArchive = await archiveFolderExclusion({ vaultPath, archiveMode, archiveFolderName, archiveDir })
      const customRoots = await workspaceRoots(vaultPath, notesDir, workspacePaths, excludeArchive)
      plans = [{ root: notesDir, actual, recursive: includeSubfolders }, ...customRoots]
    } catch (error) {
      return {
        configured: false,
        error: `读不到默认工作空间：${notesDir}（${error?.cause?.code ?? error?.code ?? error?.message ?? '未知错误'}）`,
        revision: UNCONFIGURED,
        notes: [],
      }
    }
    // 摘要缓存和 revision 共同使用校验后的、有序的挂载根；主空间单独计入。
    const workspaceKey = plans.slice(1).map(({ root }) => root).join('\u0001')
    const scanKey = `${vaultPath}\u0000${notesDir}\u0000${includeSubfolders ? '1' : '0'}\u0000${titleMode}\u0000${this.projectKey}\u0000${archiveMode}\u0000${archiveFolderName}\u0000${archiveDir}\u0000${workspaceKey}`
    if (this.scanKey !== scanKey) {
      this.entries.clear()
      this.fullNotes.clear()
      this.scanKey = scanKey
    }

    // 每个文件只归入第一个命中的根：默认工作空间优先，其次是按标签顺序挂载的工作空间。
    const collected = new Map()
    for (const plan of plans) {
      const files = []
      await collectMarkdown(plan.root, plan.actual, 0, files, plan.recursive, excludeArchive)
      for (const absolute of files) {
        if (!collected.has(absolute)) collected.set(absolute, plan.root)
      }
    }

    const seen = new Set()
    const signature = []
    const notes = []

    for (const [absolute, root] of collected) {
      let info
      try {
        info = await stat(absolute)
      } catch {
        continue
      }
      if (!info.isFile() || info.size > LIMITS.maxFileBytes) continue
      const relPath = relative(vaultPath, absolute).split(sep).join('/')
      const relativeToRoot = relative(root, absolute).split(sep).join('/')
      const fingerprint = fileSignature(info)

      let entry = this.entries.get(absolute)
      if (
        entry !== undefined
        && entry.fingerprint === fingerprint
        && entry.scanKey === this.scanKey
      ) {
        seen.add(absolute)
        notes.push(entry.summary)
        signature.push(`${root}\u0000${relativeToRoot}:${fingerprint}`)
        continue
      }
      this.fullNotes.delete(absolute)
      let text
      try {
        text = await readFile(absolute, 'utf8')
      } catch {
        continue
      }
      // 解析到 scanComments 条，保证 commentKinds 覆盖「全部评论」；summary 只取前 6 条。
      const parsed = parseNote(text, { maxComments: LIMITS.scanComments, maxBlocks: LIMITS.blocks, titleMode, projectKey: this.projectKey, withCardPreview: true })
      const tag = tagForRelativePath(relativeToRoot)
      entry = {
        path: absolute,
        relPath,
        name: relativeToRoot.split('/').pop().replace(/\.md$/i, ''),
        tag,
        color: colorForTag(tag),
        darkColor: darkColorForTag(tag),
        created: Math.round(info.birthtimeMs || info.ctimeMs || info.mtimeMs),
        mtime: info.mtimeMs,
        size: info.size,
        scanKey: this.scanKey,
        fingerprint,
        summary: null,
      }
      entry.summary = buildSummary(entry, parsed, titleMode)
      seen.add(absolute)
      this.entries.set(absolute, entry)
      notes.push(entry.summary)
      signature.push(`${root}\u0000${relativeToRoot}:${fingerprint}`)
    }

    for (const key of [...this.entries.keys()]) {
      if (!seen.has(key)) {
        this.entries.delete(key)
        this.fullNotes.delete(key)
      }
    }

    // 默认按创建时间（新 → 旧）；其余排序由面板切换。
    notes.sort((a, b) => (b.created - a.created) || a.relPath.localeCompare(b.relPath))
    signature.sort()
    this.revision = createHash('sha1')
      .update(`${notesDir}\u0000${workspaceKey}\u0000${signature.join('\u0001')}`)
      .digest('hex')
      .slice(0, 16)

    return { configured: true, error: null, revision: this.revision, notes }
  }

  /**
   * 读取一张便签的全文（阅读视图用）。
   * @param {string} filePath - md 绝对路径（调用方负责校验在 notesDir 内）。
   * @returns {Promise<object | null>}
   */
  async readFull(filePath) {
    const entry = this.entries.get(filePath)
    if (entry === undefined) return null
    const cached = this.fullNotes.get(filePath)
    if (cached) {
      this.fullNotes.delete(filePath)
      this.fullNotes.set(filePath, cached)
      return cached
    }
    const text = await readNoteFile(filePath)
    const parsed = parseNote(text, { maxComments: LIMITS.scanComments, maxBlocks: LIMITS.blocks, titleMode: this.titleMode, projectKey: this.projectKey })
    const full = {
      ...entry.summary,
      body: getBody(text),
      contentRevision: contentRevision(text),
      blocks: parsed.blocks,
      comments: parsed.comments.slice(0, LIMITS.fullComments),
      projects: parsed.projects,
    }
    // 读取期间可能发生 invalidate/reset；旧快照不重新进入缓存。
    if (this.entries.get(filePath) === entry) {
      this.fullNotes.set(filePath, full)
      if (this.fullNotes.size > FULL_CACHE_LIMIT) this.fullNotes.delete(this.fullNotes.keys().next().value)
    }
    return full
  }

  /** 单个文件的当前缓存摘要（写入后使用）。 */
  summary(filePath) {
    return this.entries.get(filePath)?.summary ?? null
  }

  /** 一段 JSON 指纹，用于 jobs 参与 revision。 */
  static hash(value) {
    return createHash('sha1').update(String(value)).digest('hex').slice(0, 16)
  }
}
