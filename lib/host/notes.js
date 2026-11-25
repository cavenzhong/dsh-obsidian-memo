/** 便签读取、新建、版本化编辑、改名、任务切换和 Obsidian 打开。 */
import { moveListItem } from '../../src/shared/list-editing.js'
import { createCapturedNote } from '../capture.js'
import { sanitizeNoteFileName } from '../filename.js'
import { assertPathWithin, contentRevision, failure, isHiddenVaultPath, isInside, readNoteFile, replaceNoteFile } from '../files.js'
import { getBody, parseNote, splitFrontmatter, summarizeImages } from '../notes.js'
import { openNoteInObsidian } from '../obsidian.js'
import { LIMITS, colorForTag, darkColorForTag } from '../shared.js'
import { debugLog, now } from './environment.js'
import { fileExists, readFullNote } from './note-content.js'
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function createNoteEndpoints({ assertNotePath, assertActiveWorkspace, getSettings, invalidateAndScan, prepareRelocation, requireNotes, resolved, scanOnce, scanner }) {
  async function endpointNote(payload) {
    const filePath = await assertNotePath(payload?.path)
    await scanOnce()
    let note = await scanner.readFull(filePath)
    if (note === null) {
      await scanOnce()
      note = await scanner.readFull(filePath)
    }
    if (note === null) {
      const full = await readFullNote(filePath, getSettings().titleMode)
      return summaryFromFull(full, filePath)
    }
    return note
  }

  function summaryFromFull(full, filePath) {
    return {
      ...full,
      relPath: relative(resolved().vault, filePath).split(sep).join('/'),
      name: basename(filePath, '.md'),
      excerpt: '',
      tag: null,
      color: colorForTag(null),
      darkColor: darkColorForTag(null),
      comments: full.comments.slice(0, LIMITS.fullComments),
      commentCount: full.commentCount,
      ...summarizeImages(full.blocks),
      commentKinds: full.commentKinds,
      mtime: now(),
      size: 0,
      pending: null,
    }
  }

  /** 扫描里有摘要就用摘要；刚写入/未挂载的工作空间文件回退到直接读取。 */
  async function summaryFor(filePath) {
    await scanOnce()
    let summary = scanner.summary(filePath)
    if (summary !== null) return summary
    await scanOnce()
    summary = scanner.summary(filePath)
    if (summary !== null) return summary
    const full = await readFullNote(filePath, getSettings().titleMode)
    return summaryFromFull(full, filePath)
  }

  /** 读取原始 .md 文件，供附件模式上传；不解析、不改写。 */
  async function endpointNoteFile(payload) {
    const filePath = await assertNotePath(payload?.path)
    const text = await readNoteFile(filePath)
    return { path: filePath, name: basename(filePath), text }
  }

  async function endpointSaveNote(payload) {
    const filePath = await assertNotePath(payload?.path)
    if (typeof payload?.body !== 'string') throw failure('bad-request', '缺少正文')
    const originalName = basename(filePath, extname(filePath))
    const requestedName = payload?.name ?? originalName
    let name = originalName
    if (requestedName !== originalName) {
      const nameCheck = sanitizeNoteFileName(requestedName)
      if (nameCheck.error === 'too-long') throw failure('bad-request', `文件名不能超过 ${LIMITS.noteNameBytes} 字节`)
      if (nameCheck.error === 'reserved') throw failure('bad-request', '文件名不能使用系统保留名')
      if (nameCheck.error === 'empty') throw failure('bad-request', '文件名不能为空')
      name = nameCheck.name
    }
    const target = name === originalName ? filePath : join(dirname(filePath), `${name}.md`)
    let caseOnlyRename = false
    await assertPathWithin(requireNotes().vault, target, { allowMissing: true })
    if (target !== filePath && await fileExists(target)) {
      // 仅大小写不同的改名：macOS/Windows 的大小写不敏感文件系统上 fileExists 会命中自己，
      // 两边 realpath 相同就说明是同一个文件，允许改名，不误报 exists。
      const [sourceReal, targetReal] = await Promise.all([
        realpath(filePath).catch(() => null),
        realpath(target).catch(() => null),
      ])
      if (sourceReal === null || targetReal === null || sourceReal !== targetReal) {
        throw failure('exists', `同名便签已存在：${name}`)
      }
      caseOnlyRename = true
    }
    const original = await readNoteFile(filePath)
    if (typeof payload.expectedRevision !== 'string' || payload.expectedRevision !== contentRevision(original)) {
      throw failure('conflict', '便签已被修改或缺少编辑版本；请先复制保留草稿，再取消编辑并重新打开')
    }
    const { frontmatter, bom } = splitFrontmatter(original)
    const bare = payload.body.replace(/\r\n?/g, '\n').replace(/^\n+/u, '').replace(/\s+$/u, '')
    const bodyText = bare === '' ? '' : `${bare}\n`
    const composed = frontmatter === null
      ? bodyText
      : bodyText === '' ? `${frontmatter}\n` : `${frontmatter}\n\n${bodyText}`
    const content = `${bom ? '\uFEFF' : ''}${composed}`
    if (Buffer.byteLength(content, 'utf8') > LIMITS.maxFileBytes) throw failure('bad-request', '便签文件过大')
    const relocation = target === filePath ? null : await prepareRelocation(requireNotes().vault, filePath, target, { caseOnlyRename })
    if (relocation?.engine === 'obsidian-cli' && await readNoteFile(filePath) !== original) {
      throw failure('conflict', '等待 Obsidian 时便签已被修改，请先保留草稿并重新打开')
    }
    const changed = content !== original
    if (changed) await replaceNoteFile(filePath, content)
    if (relocation) {
      try { await relocation.move(changed ? { expectedContent: content } : undefined) }
      catch (error) {
        if (error.code === 'EEXIST') throw failure('exists', `同名便签已存在：${name}${changed ? '；正文已保存在原文件中' : ''}`)
        if (changed) throw failure(error.code, `${error.message} 本次正文已写入，请检查实际文件后再保存。`, error)
        throw error
      }
    }
    await invalidateAndScan(filePath)
    return { note: await summaryFor(target) }
  }

  async function endpointCreateNote(payload) {
    const paths = requireNotes()
    // 0.18 工作空间：targetDir（绝对路径，仓库内）优先；旧客户端的 folder（相对默认工作空间）继续兼容。
    const rawTarget = typeof payload?.targetDir === 'string' ? payload.targetDir.trim() : ''
    let targetDir = ''
    if (rawTarget !== '') {
      targetDir = resolve(rawTarget)
      if (!isInside(paths.vault, targetDir) || isHiddenVaultPath(paths.vault, targetDir)) {
        throw failure('bad-request', '工作空间必须是仓库内的可见文件夹')
      }
    } else {
      const folder = typeof payload?.folder === 'string' ? payload.folder.trim() : ''
      if (folder !== '' && folder !== '.') {
        if (isAbsolute(folder)) throw failure('bad-request', '工作空间必须是仓库内的相对路径')
        const parts = folder.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.')
        if (parts.some((part) => part === '..' || part.startsWith('.'))) throw failure('bad-request', '工作空间文件夹不能越出默认工作空间或位于隐藏目录')
        if (parts.length > 0) targetDir = join(paths.notes, ...parts)
      }
    }
    const actual = await assertActiveWorkspace(paths.vault, targetDir || paths.notes)
    const info = await stat(actual).catch(() => null)
    if (!info || !info.isDirectory()) throw failure('not-found', '工作空间文件夹不存在')
    const path = await createCapturedNote({
      ...paths,
      targetDir,
      titleMode: getSettings().titleMode,
      fileNamePattern: getSettings().fileNamePattern,
    }, payload)
    await invalidateAndScan(path).catch((error) => debugLog('新建后刷新失败：', error.message))
    // 目录可在创建后被切换；提交已落盘时依然返回成功，避免重试产生歧义。
    return { note: await summaryFor(path), path }
  }

  async function endpointReorderTask(payload) {
    const filePath = await assertNotePath(payload?.path)
    const { sourceLine, targetLine, after, expectedRevision } = payload || {}
    if (!Number.isInteger(sourceLine) || !Number.isInteger(targetLine) || typeof after !== 'boolean') throw failure('bad-request', '列表项参数无效')
    const original = await readNoteFile(filePath)
    if (typeof expectedRevision !== 'string' || expectedRevision !== contentRevision(original)) throw failure('conflict', '便签已被修改，请刷新后再排序')
    const blocks = parseNote(original, { titleMode: getSettings().titleMode }).blocks
    if (![sourceLine, targetLine].every((line) => blocks.some((block) => block.kind === 'li' && block.sourceLine === line))) throw failure('bad-request', '只能移动阅读模式中的无序列表项或任务项')
    const split = splitFrontmatter(original)
    const moved = moveListItem(split.body, sourceLine, targetLine, after)
    if (!moved) throw failure('bad-request', '只能在同一层级的连续列表内排序')
    // 只替换正文行内容；原 BOM、YAML、空行和每个原始换行分隔符保持不变。
    const raw = original.split(/(\r\n|\r|\n)/)
    const lines = moved.text.split('\n')
    const offset = Math.ceil(raw.length / 2) - lines.length
    lines.forEach((line, index) => { raw[(offset + index) * 2] = line })
    if (split.bom && offset === 0) raw[0] = '\uFEFF' + raw[0]
    await replaceNoteFile(filePath, raw.join(''))
    await invalidateAndScan(filePath)
    return { note: await summaryFor(filePath) }
  }

  async function endpointToggleTask(payload) {
    const filePath = await assertNotePath(payload?.path)
    const sourceLine = Number(payload?.sourceLine)
    if (!Number.isInteger(sourceLine) || sourceLine < 0 || typeof payload?.checked !== 'boolean') throw failure('bad-request', '任务项参数无效')
    const original = await readNoteFile(filePath)
    const split = splitFrontmatter(original)
    if (getBody(original) !== payload?.expectedBody) throw failure('conflict', '便签已被修改，请刷新后再勾选')
    if (!parseNote(original, { titleMode: getSettings().titleMode }).blocks.some((block) => block.kind === 'li' && typeof block.checked === 'boolean' && block.sourceLine === sourceLine)) throw failure('bad-request', '只能修改阅读模式中的任务项')
    const lines = split.body.split('\n')
    if (sourceLine >= lines.length) throw failure('bad-request', '任务项已变化，请刷新后重试')
    const line = lines[sourceLine]
    const match = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+.*)$/)
    if (!match) throw failure('bad-request', '这行已不是任务项，请刷新后重试')
    // 只替换对应行的任务标记，保留 BOM、frontmatter、空行与原换行格式。
    const raw = original.split(/(\r\n|\r|\n)/)
    const lineIndex = (Math.ceil(raw.length / 2) - lines.length + sourceLine) * 2
    raw[lineIndex] = raw[lineIndex].replace(/(\[)[ xX](\])/, `$1${payload.checked ? 'x' : ' '}$2`)
    await replaceNoteFile(filePath, raw.join(''))
    await invalidateAndScan(filePath)
    return { note: await summaryFor(filePath) }
  }

  async function endpointOpenInObsidian(payload) {
    const raw = payload?.path
    if (typeof raw !== 'string' || raw.trim() === '') throw failure('bad-request', '缺少便签路径')
    const target = resolve(raw)
    const vault = getSettings().vaultPath ? resolve(getSettings().vaultPath) : ''
    if (vault === '' || !isInside(vault, target)) throw failure('bad-request', '便签必须在仓库内')
    await assertPathWithin(vault, target)
    const info = await stat(target).catch(() => null)
    if (info === null || !info.isFile()) throw failure('not-found', '便签不存在')
    const opened = await openNoteInObsidian(target)
    if (opened?.ok !== true) {
      throw failure('open-failed', opened?.message ? `打开 Obsidian 失败：${opened.message}` : '打开 Obsidian 失败')
    }
    return { url: opened.url }
  }

  return { endpointNote, endpointNoteFile, endpointSaveNote, endpointCreateNote, endpointToggleTask, endpointReorderTask, endpointOpenInObsidian }
}

export { createNoteEndpoints }
