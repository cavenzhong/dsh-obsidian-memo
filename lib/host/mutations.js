/** 归档、删除、撤回与系统回收站操作；保留独占移动和整组回滚。 */
import { assertPathWithin, failure, isInside, moveFileExclusive, readNoteFile } from '../files.js'
import { openExternalUrl } from '../obsidian.js'
import { makeId } from '../settings.js'
import { LIMITS } from '../shared.js'
import { DELETE_UNDO_MS, moveVaultTrashToSystem, noteAttachments, restoreTrashedNote, trashNote, vaultTrashInfo } from '../trash.js'
import { now } from './environment.js'
import { ensureDir, fileExists } from './note-content.js'
import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

function createMutationEndpoints({
  assertNotePath, clearImagePaths, deleteUndos, invalidateAndScan, invalidateScan, jobs, purgeExpiredState,
  requireNotes, resolved, undos, withNoteWrite,
}) {
  async function endpointArchive(payload) {
    const paths = requireNotes()
    const filePath = await assertNotePath(payload?.path)
    let targetDir
    let boundary
    if (paths.archiveMode === 'mapped') {
      if (!paths.archiveDir) throw failure('bad-request', '请先选择指定归档文件夹')
      if (!isInside(paths.vault, paths.archiveDir)) throw failure('bad-request', '归档目录不在仓库内')
      if (isInside(paths.notes, paths.archiveDir) || isInside(paths.archiveDir, paths.notes)) throw failure('bad-request', '指定归档文件夹不能与便签目录重叠')
      const archiveReal = await assertPathWithin(paths.vault, paths.archiveDir, { allowMissing: true })
      const notesReal = await assertPathWithin(paths.vault, paths.notes)
      if (isInside(notesReal, archiveReal) || isInside(archiveReal, notesReal)) throw failure('bad-request', '指定归档文件夹不能与便签目录重叠')
      const relativeFolder = relative(paths.notes, dirname(filePath))
      if (relativeFolder === '..' || relativeFolder.startsWith(`..${sep}`) || isAbsolute(relativeFolder)) throw failure('bad-request', '便签目录结构无效')
      targetDir = join(paths.archiveDir, relativeFolder)
      boundary = paths.archiveDir
    } else {
      targetDir = join(dirname(filePath), paths.archiveFolderName)
      boundary = paths.notes
    }
    await assertPathWithin(paths.vault, targetDir, { allowMissing: true })
    await readNoteFile(filePath)
    await ensureDir(targetDir)
    await assertPathWithin(boundary, targetDir)
    const sourceName = basename(filePath)
    let candidate = join(targetDir, sourceName)
    if (await fileExists(candidate)) {
      const stem = sourceName.replace(/\.md$/i, '')
      let index = 2
      for (; index < 100; index += 1) {
        candidate = join(targetDir, `${stem} (${index}).md`)
        if (!(await fileExists(candidate))) break
      }
      if (index >= 100) throw failure('exists', '目标目录里同名文件太多')
    }
    await assertPathWithin(paths.vault, candidate, { allowMissing: true })
    await moveFileExclusive(filePath, candidate)
    await invalidateAndScan(filePath)
    const undoToken = makeId('undo')
    purgeExpiredState()
    undos.set(undoToken, { from: filePath, to: candidate, expires: now() + LIMITS.undoTtlMs })
    return { undoToken, to: candidate }
  }

  async function endpointUndoArchive(payload) {
    const token = typeof payload?.undoToken === 'string' ? payload.undoToken : ''
    const entry = undos.get(token)
    if (!entry || entry.expires < now()) {
      undos.delete(token)
      throw failure('not-found', '撤销窗口已过期')
    }
    const paths = requireNotes()
    await assertPathWithin(paths.vault, entry.to)
    await assertPathWithin(paths.vault, paths.notes)
    await assertPathWithin(paths.notes, entry.from, { allowMissing: true })
    if (await fileExists(entry.from)) throw failure('exists', '原位置已有同名文件，无法恢复')
    await ensureDir(dirname(entry.from))
    await moveFileExclusive(entry.to, entry.from)
    undos.delete(token)
    await invalidateAndScan(entry.from)
    return { restoredTo: entry.from }
  }

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

  return { endpointArchive, endpointUndoArchive, endpointDeleteNote, endpointUndoDelete, endpointTrash }
}

export { createMutationEndpoints }
