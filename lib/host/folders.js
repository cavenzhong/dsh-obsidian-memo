/** 仓库内目录浏览、新建与系统选择器。 */
import { assertPathWithin, failure, isHiddenVaultPath } from '../files.js'
import { resolveUserPath } from '../settings.js'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

function createFolderEndpoints({ ctx, getSettings }) {
  async function folderInVault(payload, allowMissing = false) {
    const vault = resolveUserPath(payload?.vaultPath || getSettings().vaultPath)
    if (!vault || !isAbsolute(vault)) throw failure('not-configured', '请先选择仓库文件夹')
    if (!(await stat(vault)).isDirectory()) throw failure('bad-request', '仓库必须是文件夹')
    const path = resolveUserPath(payload?.path || '.', vault)
    await assertPathWithin(vault, path, { allowMissing })
    if (isHiddenVaultPath(vault, path)) throw failure('bad-request', '请选择仓库内非隐藏文件夹')
    return { vault, path }
  }

  async function endpointListFolders(payload) {
    const { vault } = await folderInVault(payload)
    const folders = ['.']
    let truncated = false
    async function walk(dir) {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.') || item.name === 'node_modules' || !item.isDirectory() || item.isSymbolicLink()) continue
        if (folders.length >= 1500) { truncated = true; return }
        const path = join(dir, item.name)
        await assertPathWithin(vault, path)
        folders.push(relative(vault, path))
        await walk(path)
        if (truncated) return
      }
    }
    await walk(vault)
    return { folders: folders.sort((a, b) => a.localeCompare(b)), truncated }
  }

  async function endpointCreateFolder(payload) {
    if (typeof payload?.path !== 'string' || !payload.path.trim() || payload.path.split(/[\\/]/).includes('..')) throw failure('bad-request', '请填写仓库内的文件夹名称')
    const { vault, path } = await folderInVault(payload, true)
    await mkdir(path, { recursive: true })
    await assertPathWithin(vault, path)
    return { path }
  }

  async function endpointChooseConfigDirectory() {
    const result = await endpointPickDirectory()
    if (!result.path) return { path: null, files: [] }
    const files = (await readdir(result.path, { withFileTypes: true }))
      .filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.json'))
      .map((item) => join(result.path, item.name)).sort()
    return { path: result.path, files }
  }

  async function endpointPickDirectory(payload) {
    const controller = ctx.get('directoryPickerController')
    if (controller === undefined) throw failure('picker-unavailable', '当前环境没有目录选择器')
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(new Error('timeout')), 10 * 60 * 1000)
    try {
      const path = await controller.pick(abort.signal)
      if (path && payload?.vaultPath) {
        const checked = await folderInVault({ vaultPath: payload.vaultPath, path })
        if (!(await stat(checked.path)).isDirectory()) throw failure('bad-request', '请选择文件夹')
      }
      return { path: typeof path === 'string' && path !== '' ? path : null }
    } catch (error) {
      if (error?.code === 'bad-request' || error?.code === 'not-configured') throw error
      throw failure('picker-unavailable', `目录选择失败：${error?.message ?? error}`, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  return { endpointListFolders, endpointCreateFolder, endpointChooseConfigDirectory, endpointPickDirectory }
}

export { createFolderEndpoints }
