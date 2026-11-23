/** 活动便签扫描、挂载和写入共用归档目录边界。 */
import { realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { assertPathWithin, isInside } from './files.js'

async function archiveFolderExclusion({ vaultPath, archiveMode, archiveDir, archiveFolderName = '归档' }) {
  if (archiveMode === 'mapped') {
    if (!archiveDir) return () => false
    const root = resolve(archiveDir)
    const actualRoot = await assertPathWithin(vaultPath, root, { allowMissing: true }).catch(() => null)
    return (dir, actual = dir) => isInside(root, dir) || (actualRoot !== null && isInside(actualRoot, actual))
  }
  if (!archiveFolderName) return () => false
  const realVault = await realpath(vaultPath)
  const hasArchiveAncestor = (root, dir) => isInside(root, dir) && relative(root, dir).split(sep).includes(archiveFolderName)
  return (dir, actual = dir) => hasArchiveAncestor(vaultPath, dir) || hasArchiveAncestor(realVault, actual)
}

export { archiveFolderExclusion }
