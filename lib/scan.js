/**
 * dsh-sticky-notes —— 便签目录扫描与缓存。
 *
 * 轮询式刷新（Obsidian 保存后数秒内反映），不注册文件监听、不占用文件锁。
 * 每次 scan 只 stat 文件；内容仅在 mtime/size 变化时重读重解析。
 * @module dsh-sticky-notes/scan
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { LIMITS, colorForTag, darkColorForTag } from './shared.js'
import {
  clip, commentKindsFrom, getBody, parseNote, summarizeImages, tagForRelativePath,
} from './notes.js'

const SKIP_DIRS = new Set(['node_modules', '__MACOSX', '.trash', '.obsidian'])
const UNCONFIGURED = 'unconfigured'

/** 是否是可以进入的目录项。 */
function walkable(dirent) {
  if (!dirent.isDirectory()) return false
  if (dirent.name.startsWith('.')) return false
  if (SKIP_DIRS.has(dirent.name)) return false
  return true
}

/**
 * 收集 md 文件（跳过符号链接、隐藏目录）。
 * @param {string} root - 当前目录。
 * @param {number} depth - 当前深度（notesDir 顶层为 0）。
 * @param {string[]} output - 收集结果。
 * @param {boolean} [recursive] - false 时只看顶层，不进入子文件夹。
 */
async function collectMarkdown(root, depth, output, recursive = true) {
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
      await collectMarkdown(absolute, depth + 1, output, recursive)
      continue
    }
    if (!dirent.isFile()) continue
    if (dirent.name.startsWith('.')) continue
    if (!dirent.name.toLowerCase().endsWith('.md')) continue
    output.push(absolute)
  }
}

/** 一条便签的缓存记录。 */
function buildSummary(entry, parsed) {
  return {
    path: entry.path,
    relPath: entry.relPath,
    name: entry.name,
    title: entry.name,
    excerpt: parsed.excerpt,
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
    this.revision = UNCONFIGURED
    this.scanKey = ''
  }

  /** 清空全部缓存（设置变化时）。 */
  reset() {
    this.entries.clear()
    this.revision = UNCONFIGURED
    this.scanKey = ''
  }

  /** 丢弃单个文件的缓存（写入后）。 */
  invalidate(filePath) {
    this.entries.delete(filePath)
    this.scanKey = ''
  }

  /**
   * 扫描一次。
   * @param {{ vaultPath: string, notesDir: string }} settings
   * @returns {Promise<{ configured: boolean, error: string | null, revision: string, notes: object[] }>}
   */
  async scan(settings) {
    const notesDir = settings?.notesDir ?? ''
    const vaultPath = settings?.vaultPath ?? ''
    const includeSubfolders = settings?.includeSubfolders !== false
    if (!notesDir || !vaultPath) {
      this.reset()
      return { configured: false, error: null, revision: UNCONFIGURED, notes: [] }
    }
    // 扫描参数（仓库 / 目录 / 是否递归）任一变化都要清缓存，避免沿用旧的 tag 与摘要。
    const scanKey = `${vaultPath}\u0000${notesDir}\u0000${includeSubfolders ? '1' : '0'}`
    if (this.scanKey !== scanKey) {
      this.entries.clear()
      this.scanKey = scanKey
    }
    try {
      const info = await stat(notesDir)
      if (!info.isDirectory()) {
        return { configured: false, error: `便签目录不是文件夹：${notesDir}`, revision: UNCONFIGURED, notes: [] }
      }
    } catch (error) {
      return {
        configured: false,
        error: `读不到便签目录：${notesDir}（${error?.code ?? error?.message ?? '未知错误'}）`,
        revision: UNCONFIGURED,
        notes: [],
      }
    }

    const files = []
    await collectMarkdown(notesDir, 0, files, includeSubfolders)
    const seen = new Set()
    const signature = []
    const notes = []

    for (const absolute of files) {
      let info
      try {
        info = await stat(absolute)
      } catch {
        continue
      }
      if (!info.isFile() || info.size > LIMITS.maxFileBytes) continue
      seen.add(absolute)
      const relPath = relative(vaultPath, absolute).split(sep).join('/')
      const relativeToNotes = relative(notesDir, absolute).split(sep).join('/')
      const signaturePart = `${relativeToNotes}:${info.size}:${Math.round(info.mtimeMs)}`
      signature.push(signaturePart)

      let entry = this.entries.get(absolute)
      if (
        entry !== undefined
        && entry.size === info.size
        && Math.round(entry.mtime) === Math.round(info.mtimeMs)
        && entry.scanKey === this.scanKey
      ) {
        notes.push(entry.summary)
        continue
      }
      let text
      try {
        text = await readFile(absolute, 'utf8')
      } catch {
        continue
      }
      // 解析到 scanComments 条，保证 commentKinds 覆盖「全部评论」；summary 只取前 6 条。
      const parsed = parseNote(text, { maxComments: LIMITS.scanComments, maxBlocks: LIMITS.blocks })
      const tag = tagForRelativePath(relativeToNotes)
      entry = {
        path: absolute,
        relPath,
        name: relativeToNotes.split('/').pop().replace(/\.md$/i, ''),
        tag,
        color: colorForTag(tag),
        darkColor: darkColorForTag(tag),
        created: Math.round(info.birthtimeMs || info.ctimeMs || info.mtimeMs),
        mtime: info.mtimeMs,
        size: info.size,
        scanKey: this.scanKey,
        body: getBody(text),
        summary: null,
        parsed,
      }
      entry.summary = buildSummary(entry, parsed)
      this.entries.set(absolute, entry)
      notes.push(entry.summary)
    }

    for (const key of [...this.entries.keys()]) {
      if (!seen.has(key)) this.entries.delete(key)
    }

    // 默认按创建时间（新 → 旧）；其余排序由面板切换。
    notes.sort((a, b) => (b.created - a.created) || a.relPath.localeCompare(b.relPath))
    signature.sort()
    this.revision = createHash('sha1')
      .update(`${notesDir}\u0000${signature.join('\u0001')}`)
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
    return {
      ...entry.summary,
      body: entry.body,
      blocks: entry.parsed.blocks,
      comments: entry.parsed.comments.slice(0, LIMITS.fullComments),
      projects: entry.parsed.projects,
    }
  }

  /** 单个文件的当前缓存摘要（写入后使用）。 */
  summary(filePath) {
    return this.entries.get(filePath)?.summary ?? null
  }

  /** 当前缓存里的 relPath → 绝对路径。 */
  files() {
    return [...this.entries.keys()]
  }

  /** 一段 JSON 指纹，用于 jobs 参与 revision。 */
  static hash(value) {
    return createHash('sha1').update(String(value)).digest('hex').slice(0, 16)
  }
}
