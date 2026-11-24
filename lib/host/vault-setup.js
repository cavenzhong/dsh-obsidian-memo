/** Check the draft vault without altering it; hand off creation/registration to Obsidian. */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { failure } from '../files.js'
import { openExternalUrl } from '../obsidian.js'
import { inspectObsidianVault, isObsidianRunning, obsidianRegistryPath, prepareObsidianCli, runObsidianCli } from '../obsidian-cli.js'
import { resolveUserPath } from '../settings.js'

const VAULT_MANAGER = 'obsidian://choose-vault'

export function createVaultSetupEndpoints({ registryPath = obsidianRegistryPath(), run = runObsidianCli, isRunning = isObsidianRunning, open = openExternalUrl } = {}) {
  async function endpointCheckVault(payload) {
    const path = resolveUserPath(payload?.path)
    const resolved = path && isAbsolute(path) ? await realpath(path).catch(() => '') : ''
    if (!resolved || !(await stat(resolved).catch(() => null))?.isDirectory()) return { status: 'invalid' }
    const detection = await inspectObsidianVault(resolved, registryPath)
    const { status } = detection
    if (status === 'overlap') return { status, paths: detection.paths }
    if (status === 'plain') return { status, canRegister: true }
    if (status === 'unregistered') return { status, vaultPath: detection.root, canRegister: detection.root === resolved }
    if (status !== 'unverified') return { status }
    const location = { vaultPath: detection.vault.root, isSubfolder: detection.vault.root !== resolved }
    if (payload?.verifyCli !== true) return { status, ...location }
    if (payload.onlyRunning === true && !(await isRunning())) return { status: 'cli-not-running', ...location }
    try {
      await prepareObsidianCli(detection.vault, run)
      return { status: 'ready', ...location }
    } catch (error) {
      if (error.code !== 'obsidian-cli-unavailable') throw error
      return { status: error.diagnostic, ...location }
    }
  }

  async function endpointOpenVaultManager(payload) {
    if (payload?.mode === 'register') {
      const selection = await endpointCheckVault({ path: payload.path })
      if (selection.canRegister !== true) throw failure('bad-request', '此目录不适合设为新库，请重新检测。')
    } else if (payload?.mode !== 'new') {
      throw failure('bad-request', '未知的仓库管理操作。')
    }
    const result = await open(VAULT_MANAGER)
    if (!result.ok) throw failure('open-failed', '无法打开 Obsidian，请确认已安装桌面版，或手动打开仓库管理器。')
    return { opened: true }
  }
  return { endpointCheckVault, endpointOpenVaultManager }
}
