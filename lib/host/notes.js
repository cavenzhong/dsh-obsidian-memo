/** 便签读取、新建、版本化编辑、改名、任务切换和 Obsidian 打开。 */
import { createCapturedNote } from '../capture.js'
import { sanitizeNoteFileName } from '../filename.js'
import { assertPathWithin, atomicWrite, contentRevision, failure, isInside, moveFileExclusive, readNoteFile } from '../files.js'
import { getBody, parseNote, splitFrontmatter, summarizeImages } from '../notes.js'
import { openNoteInObsidian } from '../obsidian.js'
import { LIMITS, colorForTag, darkColorForTag } from '../shared.js'
import { debugLog, now } from './environment.js'
import { fileExists, readFullNote } from './note-content.js'
import { realpath, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

function createNoteEndpoints({ assertNotePath, getSettings, invalidateAndScan, requireNotes, resolved, scanOnce, scanner }) {
  async function endpointNote(payload) {
    const filePath = await assertNotePath(payload?.path)
    await scanOnce()
    let note = await scanner.readFull(filePath)
    if (note === null) {
      await scanOnce()
      note = await scanner.readFull(filePath)
    }
    if (note === null) {
      const full = await readFullNote(filePath)
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
    return note
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
    await atomicWrite(filePath, content)
    if (target !== filePath) {
      try {
        if (caseOnlyRename) await rename(filePath, target)
        else await moveFileExclusive(filePath, target)
      } catch (error) {
        if (error.code === 'EEXIST') throw failure('exists', `同名便签已存在：${name}；正文已保存在原文件中`)
        throw error
      }
    }
    await invalidateAndScan(filePath)
    const note = scanner.summary(target)
    if (note === null) throw failure('fs-failed', '保存后读不到便签')
    return { note }
  }

  async function endpointCreateNote(payload) {
    const path = await createCapturedNote(requireNotes(), payload)
    await invalidateAndScan(path).catch((error) => debugLog('新建后刷新失败：', error.message))
    // 目录可在创建后被切换；提交已落盘时依然返回成功，避免重试产生歧义。
    return { note: scanner.summary(path), path }
  }

  async function endpointToggleTask(payload) {
    const filePath = await assertNotePath(payload?.path)
    const sourceLine = Number(payload?.sourceLine)
    if (!Number.isInteger(sourceLine) || sourceLine < 0 || typeof payload?.checked !== 'boolean') throw failure('bad-request', '任务项参数无效')
    const original = await readNoteFile(filePath)
    const split = splitFrontmatter(original)
    if (getBody(original) !== payload?.expectedBody) throw failure('conflict', '便签已被修改，请刷新后再勾选')
    if (!parseNote(original).blocks.some((block) => block.kind === 'li' && block.sourceLine === sourceLine)) throw failure('bad-request', '只能修改阅读模式中的任务项')
    const lines = split.body.split('\n')
    if (sourceLine >= lines.length) throw failure('bad-request', '任务项已变化，请刷新后重试')
    const line = lines[sourceLine]
    const match = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+.*)$/)
    if (!match) throw failure('bad-request', '这行已不是任务项，请刷新后重试')
    // 只替换对应行的任务标记，保留 BOM、frontmatter、空行与原换行格式。
    const raw = original.split(/(\r\n|\r|\n)/)
    const lineIndex = (Math.ceil(raw.length / 2) - lines.length + sourceLine) * 2
    raw[lineIndex] = raw[lineIndex].replace(/(\[)[ xX](\])/, `$1${payload.checked ? 'x' : ' '}$2`)
    await atomicWrite(filePath, raw.join(''))
    await invalidateAndScan(filePath)
    return { note: scanner.summary(filePath) }
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

  return { endpointNote, endpointSaveNote, endpointCreateNote, endpointToggleTask, endpointOpenInObsidian }
}

export { createNoteEndpoints }
