/** 按最新配置解析工作目录，并统一校验便签与真实路径。 */
import { assertPathWithin, failure, isInside } from '../files.js'
import { extname, resolve } from 'node:path'

function createVaultPaths({ getSettings }) {
  function resolved() {
    const vault = getSettings().vaultPath ? resolve(getSettings().vaultPath) : ''
    return {
      vault,
      notes: getSettings().notesDir ? resolve(getSettings().notesDir) : '',
      project: getSettings().projectDir ? resolve(getSettings().projectDir) : '',
      attachmentDir: getSettings().attachmentDir ? resolve(getSettings().attachmentDir) : '',
      archive: getSettings().archiveTargets.map((target) => ({ ...target, path: resolve(target.path) })),
    }
  }

  function requireNotes() {
    const paths = resolved()
    if (!paths.vault || !paths.notes) throw failure('not-configured', '还没有配置仓库与便签目录')
    return paths
  }

  async function assertNotePath(filePath) {
    const paths = requireNotes()
    if (typeof filePath !== 'string' || filePath.trim() === '') throw failure('bad-request', '缺少便签路径')
    const absolute = resolve(filePath)
    if (!isInside(paths.notes, absolute)) throw failure('bad-request', '便签不在配置的便签目录内')
    if (extname(absolute).toLowerCase() !== '.md') throw failure('bad-request', '不是 markdown 文件')
    await assertPathWithin(paths.vault, paths.notes)
    const actual = await assertPathWithin(paths.notes, absolute)
    if (extname(actual).toLowerCase() !== '.md') throw failure('bad-request', '便签符号链接目标不是 markdown 文件')
    return absolute
  }

  return { resolved, requireNotes, assertNotePath }
}

export { createVaultPaths }
