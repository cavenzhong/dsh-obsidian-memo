/** 归档、删除、撤回与系统回收站操作；保留独占移动和整组回滚。 */
import { assertPathWithin, failure, isHiddenVaultPath, isInside, readNoteFile } from '../files.js'
import { openExternalUrl } from '../obsidian.js'
import { makeId } from '../settings.js'
import { LIMITS } from '../shared.js'
import { DELETE_UNDO_MS, moveVaultTrashToSystem, noteAttachments, restoreTrashedNote, trashNote, vaultTrashInfo } from '../trash.js'
import { now } from './environment.js'
import { ensureDir, fileExists } from './note-content.js'
import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 识别移动完成后的文件版本；同名新文件（即使正文相同）也不能当作原便签。 */
async function movedFileVersion(path) {
  const info = await lstat(path, { bigint: true }).catch(() => null)
  return info?.isFile() ? `${info.dev}:${info.ino}:${info.birthtimeNs}:${info.ctimeNs}:${info.mtimeNs}:${info.size}` : null
}

function createMutationEndpoints({
  assertNotePath, assertActiveWorkspace, clearImagePaths, deleteUndos, invalidateAndScan, invalidateScan, jobs,
  prepareRelocation, purgeExpiredState, requireNotes, resolved, scanner, undos, withNoteWrite, withNoteWrites,
}) {
  async function rememberMove(from, to, engine) {
    const version = await movedFileVersion(to)
    const undoToken = makeId('undo')
    purgeExpiredState()
    undos.set(undoToken, { from, to, engine, version, expires: now() + LIMITS.undoTtlMs })
    return undoToken
  }

  /** 目标目录里的独占文件名：同名时依次追加 (2)、(3)…，不覆盖已有文件。 */
  async function availableTarget(targetDir, sourceName) {
    const candidate = join(targetDir, sourceName)
    if (!(await fileExists(candidate))) return candidate
    const stem = sourceName.replace(/\.md$/i, '')
    for (let index = 2; index < 100; index += 1) {
      const next = join(targetDir, `${stem} (${index}).md`)
      if (!(await fileExists(next))) return next
    }
    throw failure('exists', '目标目录里同名文件太多')
  }

  async function endpointArchive(payload) {
    const paths = requireNotes()
    const filePath = await assertNotePath(payload?.path)
    let targetDir
    let boundary
    if (paths.archiveMode === 'mapped') {
      if (!paths.archiveDir) throw failure('bad-request', '请先选择指定归档文件夹')
      if (!isInside(paths.vault, paths.archiveDir)) throw failure('bad-request', '归档目录不在仓库内')
      if (isInside(paths.notes, paths.archiveDir) || isInside(paths.archiveDir, paths.notes)) throw failure('bad-request', '指定归档文件夹不能与默认工作空间重叠')
      const archiveReal = await assertPathWithin(paths.vault, paths.archiveDir, { allowMissing: true })
      const notesReal = await assertPathWithin(paths.vault, paths.notes)
      if (isInside(notesReal, archiveReal) || isInside(archiveReal, notesReal)) throw failure('bad-request', '指定归档文件夹不能与默认工作空间重叠')
      const sourceDir = dirname(filePath)
      // 默认工作空间内沿用原有「默认工作空间结构」；其它工作空间的便签按仓库相对结构映射。
      const relativeFolder = isInside(paths.notes, sourceDir) ? relative(paths.notes, sourceDir) : relative(paths.vault, sourceDir)
      if (relativeFolder === '..' || relativeFolder.startsWith(`..${sep}`) || isAbsolute(relativeFolder)) throw failure('bad-request', '默认工作空间结构无效')
      targetDir = join(paths.archiveDir, relativeFolder)
      boundary = paths.archiveDir
    } else {
      targetDir = join(dirname(filePath), paths.archiveFolderName)
      boundary = paths.vault
    }
    await assertPathWithin(paths.vault, targetDir, { allowMissing: true })
    await readNoteFile(filePath)
    await ensureDir(targetDir)
    await assertPathWithin(boundary, targetDir)
    const sourceName = basename(filePath)
    const candidate = await availableTarget(targetDir, sourceName)
    await assertPathWithin(paths.vault, candidate, { allowMissing: true })
    const relocation = await prepareRelocation(paths.vault, filePath, candidate)
    await relocation.move()
    const undoToken = await rememberMove(filePath, candidate, relocation.engine)
    await invalidateAndScan(filePath)
    return { undoToken, to: candidate }
  }

  async function endpointUndoArchive(payload) {
    const token = typeof payload?.undoToken === 'string' ? payload.undoToken : ''
    const entry = undos.get(token)
    if (!entry || entry.expires < now()) {
      undos.delete(token)
      throw failure('not-found', '撤销窗口已过期')
    }
    return withNoteWrites([entry.to, entry.from], async () => {
      if (undos.get(token) !== entry || entry.expires < now()) throw failure('not-found', '撤销窗口已过期')
      const paths = requireNotes()
      await assertPathWithin(paths.vault, entry.from, { allowMissing: true })
      await assertPathWithin(paths.vault, entry.to, { allowMissing: true })
      if (await fileExists(entry.from)) throw failure('exists', '原位置已有同名文件，无法恢复')
      if (entry.version === null || await movedFileVersion(entry.to) !== entry.version) {
        throw failure('conflict', '目标便签已被替换、修改或移走，无法撤销')
      }
      await ensureDir(dirname(entry.from))
      const relocation = await prepareRelocation(paths.vault, entry.to, entry.from, { engine: entry.engine }).catch((error) => {
        if (error.code !== 'obsidian-cli-unavailable') throw error
        throw failure('obsidian-undo-unavailable', `${error.cliReason} 这次撤销必须使用原来的 Obsidian CLI，才能同步更新链接。`, error)
      })
      if (await movedFileVersion(entry.to) !== entry.version) throw failure('conflict', '目标便签已被修改，无法撤销')
      await relocation.move()
      undos.delete(token)
      await invalidateAndScan(entry.from)
      return { restoredTo: entry.from }
    }, { exclusive: true })
  }

  /**
   * 0.18 工作空间迁移：把便签移动到仓库内的工作空间文件夹。
   * 目标必须已存在（由目录选择器或工作空间标签保证），不创建新目录；同名自动避让。
   */
  async function endpointMoveNote(payload) {
    const paths = requireNotes()
    const filePath = await assertNotePath(payload?.path)
    const targetValue = typeof payload?.targetDir === 'string' ? payload.targetDir.trim() : ''
    if (targetValue === '') throw failure('bad-request', '缺少目标文件夹')
    const targetDir = resolve(targetValue)
    if (!isInside(paths.vault, targetDir) || isHiddenVaultPath(paths.vault, targetDir)) {
      throw failure('bad-request', '只能把便签移动到仓库内的可见工作空间')
    }
    const actualTarget = await assertActiveWorkspace(paths.vault, targetDir)
    const targetInfo = await stat(actualTarget).catch(() => null)
    if (!targetInfo || !targetInfo.isDirectory()) throw failure('not-found', '工作空间文件夹不存在')
    // 用真实路径比较：macOS 的 /var → /private/var 等系统符号链接不能把同一目录误判成两个。
    if (await realpath(dirname(filePath)) === actualTarget) throw failure('bad-request', '便签已经在这个文件夹里')
    if ([...jobs.values()].some((job) => job.path === filePath && job.status === 'running')) throw failure('busy', '请等这张便签的 AI 任务完成后再移动')
    await readNoteFile(filePath)
    // 文件操作沿用配置路径（不经 realpath），与扫描/撤销 token 的路径写法保持一致。
    const candidate = await availableTarget(targetDir, basename(filePath))
    await assertPathWithin(paths.vault, candidate, { allowMissing: true })
    const relocation = await prepareRelocation(paths.vault, filePath, candidate)
    await relocation.move()
    const undoToken = await rememberMove(filePath, candidate, relocation.engine)
    await invalidateAndScan(filePath)
    return { to: candidate, undoToken, note: scanner ? scanner.summary(candidate) : null }
  }

  // 迁移撤销与归档撤销共用同一份独占移动、token 过期与路径边界校验。
  const endpointUndoMove = endpointUndoArchive

  async function endpointDeleteNote(payload) {
    const paths = requireNotes()
    const filePath = await assertNotePath(payload?.path)
    if ((await lstat(filePath)).isSymbolicLink()) throw failure('bad-request', '请在原文件位置删除便签，不能删除符号链接')
    if ([...jobs.values()].some((job) => job.path === filePath && job.status === 'running')) throw failure('busy', '请等这张便签的 AI 任务完成后再删除')
    const original = await readNoteFile(filePath)
    const vault = await realpath(paths.vault), notePath = await realpath(filePath)
    const attachments = await noteAttachments(vault, notePath, original)
    const entry = await trashNote(vault, notePath, attachments.images)
    purgeExpiredState()
    const undoToken = makeId('delete')
    const expiresAt = now() + DELETE_UNDO_MS
    deleteUndos.set(undoToken, { ...entry, expires: expiresAt })
    clearImagePaths()
    invalidateScan(filePath)
    return { undoToken, expiresAt, imageCount: attachments.images.length, sharedImageCount: attachments.shared }
  }

  async function endpointUndoDelete(payload) {
    const token = typeof payload?.undoToken === 'string' ? payload.undoToken : ''
    const entry = deleteUndos.get(token)
    if (!entry || entry.expires <= now()) {
      deleteUndos.delete(token)
      throw failure('not-found', '撤回窗口已过期，可在仓库 .trash 文件夹中找回文件')
    }
    if (!resolved().vault || await realpath(resolved().vault) !== entry.vault) throw failure('conflict', '仓库设置已更改，请在原仓库 .trash 文件夹中恢复文件')
    await withNoteWrite(entry.entries[0].from, () => restoreTrashedNote(entry))
    deleteUndos.delete(token)
    invalidateScan(entry.entries[0].from)
    clearImagePaths()
    return { restoredTo: entry.entries[0].from }
  }

  async function endpointTrash(payload) {
    const vault = resolved().vault
    if (!vault) throw failure('not-configured', '请先选择仓库')
    const info = await vaultTrashInfo(vault)
    if (payload?.action === 'reveal') {
      if (!info.exists) throw failure('not-found', '仓库回收站为空')
      const opened = await openExternalUrl(info.path)
      if (!opened.ok) throw failure('open-failed', opened.message)
    } else if (payload?.action === 'empty') {
      if (payload.confirm !== true) throw failure('bad-request', '请先确认移至系统垃圾桶')
      if ([...deleteUndos.values()].some((item) => item.expires > now())) throw failure('busy', '请等待 5 秒撤回窗口结束后再清理')
      const result = await moveVaultTrashToSystem(vault)
      deleteUndos.clear()
      return result
    } else if (payload?.action !== 'info') throw failure('bad-request', '未知回收站操作')
    return info
  }

  return { endpointArchive, endpointUndoArchive, endpointMoveNote, endpointUndoMove, endpointDeleteNote, endpointUndoDelete, endpointTrash }
}

export { createMutationEndpoints }
