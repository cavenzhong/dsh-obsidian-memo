/** Read-only vault discovery and the official Obsidian CLI process boundary. */
import { execFile } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { failure, isInside } from './files.js'

const execute = promisify(execFile)
const LINK_SETTING = 'code=app.vault.getConfig("alwaysUpdateLinks") === true'
const SWITCH_HINT = '如需继续，可在设置 → 文件夹 → 操作引擎选择「文件夹管理」；它不会更新双链。'

export function cliUnavailable(message, cause, diagnostic = 'cli-not-ready') {
  return Object.assign(failure('obsidian-cli-unavailable', `${message} ${SWITCH_HINT}`, cause), { cliReason: message, diagnostic })
}

export function obsidianRegistryPath({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const root = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming')
    : env.XDG_CONFIG_HOME || join(home, '.config')
  return join(root, 'obsidian', 'obsidian.json')
}

/** A CLI call may launch Obsidian. Passive settings checks first look for the app. */
export async function isObsidianRunning() {
  const options = { timeout: 2000, windowsHide: true }
  try {
    if (process.platform === 'win32') {
      const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe')
      const { stdout } = await execute(executable, [
        '/FI', 'IMAGENAME eq Obsidian.exe', '/FI', `USERNAME eq ${userInfo().username}`, '/FO', 'CSV', '/NH',
      ], options)
      return /^"Obsidian\.exe",/im.test(stdout)
    }
    const { stdout } = await execute('/usr/bin/pgrep', ['-U', String(process.getuid()), '-ix', 'obsidian'], options)
    return stdout.trim().length > 0
  } catch { return false }
}

export async function runObsidianCli(args, { cwd }) {
  const candidates = process.platform === 'win32'
    ? [join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Obsidian', 'Obsidian.com'), 'Obsidian.com']
    : process.platform === 'darwin' ? ['/usr/local/bin/obsidian', 'obsidian'] : ['obsidian']
  let last
  for (const executable of candidates) {
    try {
      const { stdout } = await execute(executable, args, { cwd, timeout: args[1] === 'move' ? 60_000 : 8_000, windowsHide: true })
      return stdout.trimEnd()
    } catch (error) {
      // Only try another executable if the previous one never started. Never retry an in-flight move.
      if (error.code !== 'ENOENT') throw error
      last = error
    }
  }
  throw last
}

async function vaultMarker(start, stop) {
  for (let dir = start; dir !== stop; dir = dirname(dir)) {
    const marker = await lstat(join(dir, '.obsidian')).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (marker) return dir
    if (dirname(dir) === dir) break
  }
  return null
}

/** Shared read-only discovery. Does not run Obsidian or walk Markdown trees. */
export async function inspectObsidianVault(configuredRoot, registryPath, directories = []) {
  try {
    const registry = JSON.parse(await readFile(registryPath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '{}'
      throw error
    }))
    if (!registry || typeof registry !== 'object' || Array.isArray(registry) ||
      (registry.vaults !== undefined && (!registry.vaults || typeof registry.vaults !== 'object' || Array.isArray(registry.vaults)))) {
      return { status: 'registry-unreadable' }
    }
    const vaults = (await Promise.all(Object.entries(registry.vaults ?? {}).map(async ([id, entry]) => {
      if (!/^[a-f\d]{16}$/i.test(id) || typeof entry?.path !== 'string' || !isAbsolute(entry.path)) return null
      const root = await realpath(entry.path).catch((error) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
        throw error
      })
      return root ? { id, root } : null
    }))).filter(Boolean)
    const vault = vaults.find(({ root }) => isInside(root, configuredRoot))
    const root = vault?.root ?? configuredRoot
    const overlaps = vaults.filter((other) => other !== vault && (isInside(root, other.root) || isInside(other.root, root)))
    if (overlaps.length) return { status: 'overlap', paths: [...new Set([root, ...overlaps.map(item => item.root)])] }
    if (!vault) {
      const marker = await vaultMarker(configuredRoot, null)
      return marker ? { status: 'unregistered', root: marker } : { status: 'plain' }
    }
    for (const dir of new Set([configuredRoot, ...directories])) {
      if (!isInside(root, dir)) return { status: 'overlap', paths: [root, dir] }
      const marker = await vaultMarker(dir, root)
      if (marker) return { status: 'overlap', paths: [root, marker], nested: true }
    }
    return { status: 'unverified', vault }
  } catch { return { status: 'registry-unreadable' } }
}

export async function findObsidianVault(configuredRoot, from, to, registryPath) {
  const selection = await inspectObsidianVault(configuredRoot, registryPath, [dirname(from), dirname(to)])
  if (selection.status === 'unverified') return selection.vault
  if (selection.status === 'overlap') {
    throw cliUnavailable(selection.nested ? '检测到嵌套的 Obsidian 仓库，无法安全移动。'
      : '检测到重叠的 Obsidian 仓库，无法确定双链应按哪个仓库更新。')
  }
  if (selection.status === 'registry-unreadable') throw cliUnavailable('无法读取 Obsidian 仓库列表或检查路径，请检查目录权限。')
  throw cliUnavailable('此目录不在 Obsidian 已知的仓库里，请先在 Obsidian 中打开仓库。')
}

export async function prepareObsidianCli(vault, run) {
  const call = async (...args) => (await run([`vault=${vault.id}`, ...args], { cwd: vault.root })).trimEnd()
  async function check(...args) {
    try {
      const result = await call(...args)
      if (/command line interface is not enabled/i.test(result)) throw cliUnavailable('Obsidian 的命令行界面未启用（设置 → 常规）。', undefined, 'cli-disabled')
      return result
    } catch (error) {
      if (error.code === 'obsidian-cli-unavailable') throw error
      if (error.code === 'ENOENT') throw cliUnavailable('未找到 Obsidian CLI，请在 Obsidian 设置中启用并注册命令。', error, 'cli-missing')
      throw cliUnavailable('Obsidian CLI 未就绪，请打开正确的仓库，稍后再试。', error)
    }
  }
  const path = await check('vault', 'info=path')
  if (!isAbsolute(path) || await realpath(resolve(path)).catch(() => null) !== vault.root) {
    throw cliUnavailable('Obsidian CLI 未返回正确的仓库路径。请打开目标仓库并等待加载完成后重试。', undefined, 'vault-mismatch')
  }
  // No paths, file content, or user input may be interpolated into this read-only expression.
  let canUpdate = await check('eval', LINK_SETTING)
  if (/command "eval" not found/i.test(canUpdate)) canUpdate = await check('dev:eval', LINK_SETTING)
  if (/^(?:=>\s*)?false$/u.test(canUpdate)) throw cliUnavailable('此 Obsidian 仓库未开启「自动更新内部链接」。', undefined, 'links-disabled')
  if (!/^(?:=>\s*)?true$/u.test(canUpdate)) throw cliUnavailable('无法确认 Obsidian 已开启「自动更新内部链接」。')
  return call
}
