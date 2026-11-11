/** 持有当前配置、文件位置和配置队列；接受新设置后通知组合入口。 */
import { pickConfigFile } from '../config-picker.js'
import { assertPathWithin, failure, isHiddenVaultPath, isInside } from '../files.js'
import { openExternalUrl } from '../obsidian.js'
import { NotesScanner } from '../scan.js'
import {
  DEFAULT_SETTINGS, locateConfig, normalizeSettings, readConfigFile, rememberConfig, resolveUserPath,
  writeConfigFile,
} from '../settings.js'
import { LEGACY_SETTINGS_FILE, PACKAGE_DIR } from './environment.js'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

async function createConfiguration({ config, onSettingsChange }) {
  const fallback = config && typeof config === 'object' ? { ...DEFAULT_SETTINGS, ...config } : DEFAULT_SETTINGS

  const location = await locateConfig({ legacyPath: LEGACY_SETTINGS_FILE })

  let settingsFile = location.path

  let settings

  let configError = ''

  try { settings = await readConfigFile(settingsFile) } catch (error) {
    settings = normalizeSettings(fallback)
    if (error.code === 'ENOENT') await writeConfigFile(settingsFile, settings, { exclusive: true })
    else configError = '配置未加载：' + error.message
  }

  let configSignature = ''

  let settingsQueue = Promise.resolve()

  function queueSettings(action) {
    const pending = settingsQueue.then(action)
    settingsQueue = pending.catch(() => {})
    return pending
  }

  function publicSettings() {
    return { ...JSON.parse(JSON.stringify(settings)), configFile: { path: settingsFile, pinned: location.pinned, error: configError, revision: configRevision() } }
  }

  function configRevision() { return NotesScanner.hash(settingsFile + '\u0000' + JSON.stringify(settings)) }

  function settingsFingerprint() {
    return JSON.stringify(publicSettings())
  }

  async function validateSettings(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw failure('bad-request', '设置格式不对')
    const normalized = normalizeSettings(raw)
    const vault = normalized.vaultPath ? resolve(normalized.vaultPath) : ''
    if (vault) {
      if (!(await stat(vault)).isDirectory()) throw failure('bad-request', '仓库必须是文件夹')
      const checks = [
        ['便签目录', normalized.notesDir],
        ['开档目录', normalized.projectDir],
        ['图片文件夹', normalized.attachmentDir],
        ...normalized.archiveTargets.map((target) => ['归档目录', target.path]),
      ]
      for (const [label, value] of checks) {
        if (!value) continue
        if (!isInside(vault, resolve(value))) throw failure('bad-request', `${label}必须在仓库内：${value}`)
        await assertPathWithin(vault, value, { allowMissing: true })
      }
      if (normalized.attachmentDir && isHiddenVaultPath(vault, normalized.attachmentDir)) {
        throw failure('bad-request', `图片文件夹不能位于隐藏目录（Obsidian 不索引以 . 开头的目录）：${normalized.attachmentDir}`)
      }
      const notesInfo = normalized.notesDir ? await stat(resolve(normalized.notesDir)).catch(() => null) : null
      if (normalized.notesDir && (notesInfo === null || !notesInfo.isDirectory())) {
        throw failure('bad-request', `便签目录不存在：${normalized.notesDir}`)
      }
      if (normalized.attachmentDir) {
        const info = await stat(normalized.attachmentDir).catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (info && !info.isDirectory()) throw failure('bad-request', `图片文件夹不是目录：${normalized.attachmentDir}`)
      }
    }
    return normalized
  }

  function acceptSettings(next) {
    const previous = settings
    settings = next
    configError = ''
    onSettingsChange(next, previous)
  }

  async function refreshConfig() {
    try {
      const info = await stat(settingsFile)
      const signature = `${info.mtimeMs}:${info.ctimeMs}:${info.size}:${info.ino}`
      if (signature === configSignature) return
      const next = await validateSettings(await readConfigFile(settingsFile))
      if (JSON.stringify(next) !== JSON.stringify(settings)) acceptSettings(next)
      configSignature = signature
      configError = ''
    } catch (error) { configError = `配置未加载，继续使用上次有效设置：${error.message}` }
  }

  async function endpointSaveSettings(payload) {
    const normalized = await validateSettings(payload?.settings)
    await refreshConfig()
    if (configError) throw failure('conflict', configError)
    if (payload?.expected && payload.expected !== configRevision()) throw failure('conflict', '配置已在其他位置更新，请重新打开设置后保存')
    acceptSettings(await writeConfigFile(settingsFile, normalized))
    return { settings: publicSettings() }
  }

  async function endpointConfigFile(payload) {
    const action = payload?.action
    if (action === 'open' || action === 'reveal') {
      const opened = action === 'open' ? await openExternalUrl(settingsFile) : await openExternalUrl(dirname(settingsFile))
      if (!opened.ok) throw failure('open-failed', opened.message)
    } else if (action === 'load' || action === 'relocate') {
      if (location.pinned) throw failure('bad-request', 'DSH_STICKY_NOTES_SETTINGS 已固定配置位置，请先移除环境变量')
      const target = resolveUserPath(payload?.path)
      if (!target || !target.toLowerCase().endsWith('.json') || !isAbsolute(target)) throw failure('bad-request', '请选择绝对路径的 JSON 文件')
      if (isInside(PACKAGE_DIR, target)) throw failure('bad-request', '配置应保存在插件安装目录以外')
      if (action === 'relocate') {
        await refreshConfig()
        if (configError) throw failure('conflict', configError)
      }
      const next = action === 'load' ? await validateSettings(await readConfigFile(target)) : settings
      if (action === 'relocate') await writeConfigFile(target, next, { exclusive: true })
      await rememberConfig(location, target)
      settingsFile = target
      configSignature = ''
      acceptSettings(next)
    } else if (action === 'reload') {
      acceptSettings(await validateSettings(await readConfigFile(settingsFile)))
      configSignature = ''
    } else throw failure('bad-request', '未知配置操作')
    return { settings: publicSettings() }
  }

  async function endpointChooseConfigFile() {
    if (location.pinned) throw failure('bad-request', 'DSH_STICKY_NOTES_SETTINGS 已固定配置位置，请先移除环境变量')
    return { path: await pickConfigFile() }
  }

  function getSettings() { return settings }

  return { queueSettings, publicSettings, settingsFingerprint, refreshConfig, endpointSaveSettings, endpointConfigFile, endpointChooseConfigFile, getSettings }
}

export { createConfiguration }
