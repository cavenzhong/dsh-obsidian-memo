/** Single relocation path for rename, workspace moves, archive and undo. */
import { lstat, readdir, realpath, rename } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { assertPathWithin, failure, isHiddenVaultPath, moveFileExclusive, readNoteFile } from '../files.js'
import { cliUnavailable, findObsidianVault, obsidianRegistryPath, prepareObsidianCli, runObsidianCli } from '../obsidian-cli.js'

async function entry(path) {
  return lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
}

function sameFile(a, b) { return a && b && a.dev === b.dev && a.ino === b.ino }

function cliPath(root, file) {
  const path = relative(root, file).split(sep).join('/')
  if (/[\\\u0000-\u001f\u007f]/u.test(path)) throw cliUnavailable('文件路径含有 Obsidian CLI 无法安全处理的字符。')
  return path
}

async function observedMove(from, to, caseOnlyRename) {
  if (!caseOnlyRename) return { from: await entry(from) !== null, to: (await entry(to))?.isFile() === true }
  const names = new Set((await readdir(dirname(to))).map((name) => name.normalize('NFC')))
  return { from: names.has(basename(from).normalize('NFC')), to: names.has(basename(to).normalize('NFC')) }
}

export function createNoteRelocator({ getSettings, invalidateScan = () => {}, run = runObsidianCli, registryPath = obsidianRegistryPath() }) {
  async function prepareRelocation(root, from, to, { engine = getSettings().operationEngine, caseOnlyRename = false } = {}) {
    if (engine === 'direct') return { engine, move: () => caseOnlyRename ? rename(from, to) : moveFileExclusive(from, to) }

    const configuredRoot = await realpath(root)
    const source = await assertPathWithin(root, from)
    const target = join(await assertPathWithin(root, dirname(to)), basename(to))
    const file = await entry(from)
    if (!file?.isFile() || isHiddenVaultPath(configuredRoot, source) || isHiddenVaultPath(configuredRoot, target)) {
      throw cliUnavailable('Obsidian CLI 只能移动仓库内的可见 Markdown 文件；不支持直接移动符号链接。')
    }
    const vault = await findObsidianVault(configuredRoot, source, target, registryPath)
    const fromPath = cliPath(vault.root, source), toPath = cliPath(vault.root, target)
    const fromArg = fromPath.normalize('NFC'), toArg = toPath.normalize('NFC')
    // Obsidian normalizes paths; on a normalization-sensitive filesystem this can select a different file.
    if ((fromArg !== fromPath && await realpath(join(vault.root, fromArg)).catch(() => null) !== source)
      || basename(toArg) !== basename(toPath)
      || (toArg !== toPath && await realpath(join(vault.root, dirname(toArg))).catch(() => null) !== dirname(target))) {
      throw cliUnavailable('无法安全匹配 Obsidian 中的 Unicode 文件路径。')
    }
    if (fromArg === toArg) throw cliUnavailable('源路径与目标路径在 Obsidian 中相同。')
    const call = await prepareObsidianCli(vault, run)
    return { engine: 'obsidian-cli', async move({ expectedContent } = {}) {
      // Recheck boundaries and destination immediately before handing the operation to Obsidian.
      if (await assertPathWithin(root, from) !== source || await assertPathWithin(root, dirname(to)) !== dirname(target)) {
        throw failure('conflict', '操作期间文件路径已变化，请重新打开便签后再试')
      }
      const [current, existing] = await Promise.all([entry(from), entry(to)])
      if (!current?.isFile() || (expectedContent === undefined ? !sameFile(file, current) : await readNoteFile(from) !== expectedContent)) {
        throw failure('conflict', '源便签已变化，请重新打开后再试')
      }
      if (existing && !(caseOnlyRename && sameFile(current, existing))) throw failure('EEXIST', '目标文件已存在')
      let output, commandError
      try { output = await call('move', `path=${fromArg}`, `to=${toArg}`) }
      catch (error) { commandError = error }
      finally { invalidateScan(from); invalidateScan(to) }
      const state = await observedMove(from, to, caseOnlyRename).catch(() => null)
      if (output === `Moved: ${fromArg} -> ${toArg}` && state?.to && !state.from) return
      const location = state?.to && !state.from ? '文件已到达目标位置，但未确认链接更新。'
        : state?.from && !state.to ? '目前文件仍在原位置。' : '目前无法确认文件位置。'
      throw failure('obsidian-move-uncertain', `Obsidian 未确认完成移动。${location} 请在 Obsidian 中检查位置与双链后再操作；没有自动改用直接移动。`, commandError)
    } }
  }
  return { prepareRelocation }
}
