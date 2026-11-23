/** 按最新配置解析工作目录，并统一校验便签与真实路径。 */
import { archiveFolderExclusion } from '../archive-folders.js'
import { assertPathWithin, failure, isHiddenVaultPath, isInside } from '../files.js'
import { extname, resolve } from 'node:path'

function createVaultPaths({ getSettings }) {
  function resolved() {
    const vault = getSettings().vaultPath ? resolve(getSettings().vaultPath) : ''
    return {
      vault,
      notes: getSettings().notesDir ? resolve(getSettings().notesDir) : '',
      project: getSettings().projectDir ? resolve(getSettings().projectDir) : '',
      attachmentDir: getSettings().attachmentDir ? resolve(getSettings().attachmentDir) : '',
      archiveMode: getSettings().archiveMode,
      archiveFolderName: getSettings().archiveFolderName,
      archiveDir: getSettings().archiveDir ? resolve(getSettings().archiveDir) : '',
    }
  }

  function requireNotes() {
    const paths = resolved()
    if (!paths.vault || !paths.notes) throw failure('not-configured', '还没有配置仓库与默认工作空间')
    return paths
  }

  async function assertNotePath(filePath) {
    const paths = requireNotes()
    if (typeof filePath !== 'string' || filePath.trim() === '') throw failure('bad-request', '缺少便签路径')
    const absolute = resolve(filePath)
    // 工作空间可以挂载仓库内任意可见文件夹，因此便签边界从默认工作空间扩大到整个仓库。
    if (!isInside(paths.vault, absolute)) throw failure('bad-request', '便签不在仓库内')
    if (isHiddenVaultPath(paths.vault, absolute)) throw failure('bad-request', '便签在仓库的隐藏目录内')
    if (extname(absolute).toLowerCase() !== '.md') throw failure('bad-request', '不是 markdown 文件')
    const actual = await assertPathWithin(paths.vault, absolute)
    if (extname(actual).toLowerCase() !== '.md') throw failure('bad-request', '便签符号链接目标不是 markdown 文件')
    return absolute
  }

  async function assertActiveWorkspace(vault, directory, options) {
    const actual = await assertPathWithin(vault, directory, options)
    const excluded = await archiveFolderExclusion({ ...getSettings(), vaultPath: vault })
    if (excluded(directory, actual)) throw failure('bad-request', '归档文件夹不能作为活动工作空间')
    return actual
  }

  return { resolved, requireNotes, assertNotePath, assertActiveWorkspace }
}

export { createVaultPaths }
