/**
 * dsh-obsidian-memo —— 设置：默认值、规范化、读写。
 *
 * 设置迁移自插件旧的 `data/settings.json`，运行时存于独立用户配置目录。
 * `Config` 只为首启提供默认值；面板与官方设置页共用 JSON 文件。
 * @module dsh-obsidian-memo/settings
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, basename, isAbsolute, normalize, resolve, join, relative } from 'node:path'
import {
  CALLOUT_TYPES, DEFAULT_AI, DEFAULT_EMOJIS, DEFAULT_PROJECT_PROMPT, FALLBACK_CALLOUT, LIMITS,
  isLegacyDefaultEmojis, isPlainObject, normalizeAi, normalizeImageCompression, DEFAULT_IMAGE_COMPRESSION,
} from './shared.js'
import { atomicWrite } from './files.js'

/** 首次运行时的设置。 */
export const DEFAULT_SETTINGS = {
  vaultPath: '',
  notesDir: '',
  projectDir: '',
  attachmentDir: '',
  archiveTargets: [],
  folderHistory: [],
  // 0.13：每枚 emoji 带一份 AI 预算（默认高：high / 8192 tokens）。
  emojis: DEFAULT_EMOJIS.map((item) => ({ ...item, ai: { ...DEFAULT_AI } })),
  projectPrompt: DEFAULT_PROJECT_PROMPT,
  // 0.13：开档（结构化项目文档）自己的一份 AI 预算，默认同为高。
  projectAi: { ...DEFAULT_AI },
  // 0.13：是否扫描便签目录的子文件夹；缺省/非 false 一律 true。
  includeSubfolders: true,
  imageCompression: { ...DEFAULT_IMAGE_COMPRESSION },
}

/** 生成稳定 id（用于 emoji / 归档目录）。 */
export function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 单行字符串：去空白、去 NUL。 */
function text(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  return value.replace(/\u0000/g, '').trim() || fallback
}

/** 路径规范化：绝对路径原样归一；相对路径相对 vault 解析；空串保留。 */
export function resolveUserPath(value, vaultPath) {
  let raw = text(value)
  if (raw === '') return ''
  if (raw === '~') raw = homedir()
  else if (raw.startsWith('~/')) raw = resolve(homedir(), raw.slice(2))
  if (isAbsolute(raw)) return normalize(raw)
  if (vaultPath) return resolve(vaultPath, raw)
  return raw
}

/** 一个归档目标。 */
function normalizeTarget(raw, index) {
  if (!isPlainObject(raw)) return null
  const path = text(raw.path)
  if (!path) return null
  const label = text(raw.label) || basename(path) || `归档 ${index + 1}`
  const id = text(raw.id) || makeId('archive')
  return { id, label, path }
}

/** 一条 emoji 定义。 */
function normalizeEmoji(raw, index) {
  if (!isPlainObject(raw)) return null
  const emoji = text(raw.emoji)
  if (!emoji) return null
  const label = text(raw.label) || `评论 ${index + 1}`
  const callout = CALLOUT_TYPES.includes(raw.callout) ? raw.callout : FALLBACK_CALLOUT
  const prompt = text(raw.prompt) || DEFAULT_EMOJIS[0].prompt
  return {
    id: text(raw.id) || makeId('emoji'),
    emoji: emoji.slice(0, 16),
    label: label.slice(0, 24),
    callout,
    prompt,
    // 0.13：这枚 emoji 生成评论时的 token 预算；旧设置文件没有该字段时补默认高。
    ai: normalizeAi(raw.ai),
  }
}

/**
 * 把任意来源的设置规范化为安全、完整的形状。
 * 非法字段回退默认值；路径解析为绝对路径（相对 vault）；去重。
 * @param {unknown} raw - data/settings.json 或 RPC 传入的设置。
 * @param {{ vaultPath?: string }} [options] - 已知仓库路径（normalize 时作为相对基准）。
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function normalizeSettings(raw, options = {}) {
  const source = isPlainObject(raw) ? raw : {}
  const vaultPath = resolveUserPath(source.vaultPath ?? DEFAULT_SETTINGS.vaultPath, options.vaultPath ?? '')
  const notesDir = resolveUserPath(source.notesDir ?? '', vaultPath)
  const projectDir = resolveUserPath(source.projectDir ?? '', vaultPath)
  const attachmentDir = resolveUserPath(source.attachmentDir ?? '', vaultPath)
  const projectPrompt = text(source.projectPrompt, '') || DEFAULT_PROJECT_PROMPT

  const archiveTargets = []
  const seenPaths = new Set()
  const rawTargets = Array.isArray(source.archiveTargets) ? source.archiveTargets : []
  for (const item of rawTargets.slice(0, 24)) {
    const target = normalizeTarget(item, archiveTargets.length)
    if (!target) continue
    target.path = resolveUserPath(target.path, vaultPath)
    if (seenPaths.has(target.path)) continue
    seenPaths.add(target.path)
    archiveTargets.push(target)
  }

  const emojis = []
  const seenIds = new Set()
  const rawEmojis = Array.isArray(source.emojis) ? source.emojis : DEFAULT_EMOJIS
  for (const item of rawEmojis.slice(0, LIMITS.emojis)) {
    const emoji = normalizeEmoji(item, emojis.length)
    if (!emoji) continue
    if (seenIds.has(emoji.id)) emoji.id = makeId('emoji')
    seenIds.add(emoji.id)
    emojis.push(emoji)
  }

  return {
    vaultPath,
    notesDir,
    projectDir,
    attachmentDir,
    archiveTargets,
    folderHistory: [...new Set([
      notesDir, projectDir, attachmentDir, ...archiveTargets.map((item) => item.path),
      ...(Array.isArray(source.folderHistory) ? source.folderHistory.filter((item) => typeof item === 'string').map((item) => resolveUserPath(item, vaultPath)) : []),
    ].filter((item) => item && vaultPath && !relative(vaultPath, item).split(/[\\/]/).some((part) => part === '..' || part.startsWith('.')) && !isAbsolute(relative(vaultPath, item))))].slice(0, 40),
    emojis: emojis.length > 0 ? emojis : DEFAULT_EMOJIS.map((item) => ({ ...item, ai: { ...DEFAULT_AI } })),
    projectPrompt,
    projectAi: normalizeAi(source.projectAi),
    // 只有显式 false 才关闭；缺省、null、旧文件里没有这个字段都按 true 处理。
    includeSubfolders: source.includeSubfolders !== false,
    imageCompression: normalizeImageCompression(source.imageCompression),
  }
}

/** 读取设置文件；不存在或损坏时返回默认值。 */
export async function readSettingsFile(filePath, fallback = DEFAULT_SETTINGS) {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    // 0.13 预设迁移：旧版默认四枚（与 LEGACY_EMOJIS 逐字段一致）整组换成新默认值。
    // 用户改过任何一项就原样保留；迁移只发生在内存里，下次 saveSettings 才落盘。
    if (isPlainObject(parsed) && isLegacyDefaultEmojis(parsed.emojis)) {
      parsed.emojis = DEFAULT_EMOJIS.map((item) => ({ ...item }))
    }
    return normalizeSettings(parsed, { vaultPath: fallback.vaultPath })
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return normalizeSettings(fallback)
    throw error
  }
}

/** 原子写入设置文件。 */
export async function writeSettingsFile(filePath, settings) {
  const normalized = normalizeSettings(settings)
  await mkdir(dirname(filePath), { recursive: true })
  await atomicWrite(filePath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
  return normalized
}

/** 两个设置是否等价（用于决定是否重扫）。 */
export function settingsEqual(a, b) {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b))
}

/** npm 安装目录之外的用户配置；环境变量仍可显式覆盖。 */
export function configHome(env = process.env, platform = process.platform, home = homedir()) {
  const root = platform === 'win32' ? (env.APPDATA || join(home, 'AppData', 'Roaming'))
    : (env.XDG_CONFIG_HOME || join(home, '.config'))
  return join(root, 'dsh-obsidian-memo')
}

/** 文件内保存仓库相对路径，运行时继续使用绝对路径。 */
export function portableSettings(settings) {
  const value = normalizeSettings(settings)
  const path = (item) => item && value.vaultPath && !isAbsolute(relative(value.vaultPath, item))
    && !relative(value.vaultPath, item).split(/[\\/]/).includes('..') ? relative(value.vaultPath, item) || '.' : item
  return { ...value, notesDir: path(value.notesDir), projectDir: path(value.projectDir), attachmentDir: path(value.attachmentDir),
    archiveTargets: value.archiveTargets.map((item) => ({ ...item, path: path(item.path) })),
    folderHistory: value.folderHistory.map(path) }
}

export async function readConfigFile(filePath) {
  const parsed = JSON.parse(await readFile(filePath, 'utf8'))
  if (!isPlainObject(parsed)) throw new Error('配置文件必须是 JSON 对象')
  if (isLegacyDefaultEmojis(parsed.emojis)) parsed.emojis = DEFAULT_EMOJIS.map((item) => ({ ...item }))
  return normalizeSettings(parsed)
}

export async function writeConfigFile(filePath, settings, { exclusive = false } = {}) {
  await mkdir(dirname(filePath), { recursive: true })
  const body = `${JSON.stringify(portableSettings(settings), null, 2)}\n`
  if (exclusive) await writeFile(filePath, body, { flag: 'wx', mode: 0o600 })
  else await atomicWrite(filePath, body, { mode: 0o600 })
  return normalizeSettings(settings)
}

export async function locateConfig({ legacyPath, home = configHome(), override = process.env.DSH_STICKY_NOTES_SETTINGS } = {}) {
  if (override) return { path: resolveUserPath(override), home, pinned: true }
  try {
    const pointer = JSON.parse(await readFile(join(home, 'location.json'), 'utf8'))
    if (typeof pointer.path === 'string' && isAbsolute(pointer.path)) return { path: pointer.path, home, pinned: false }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const path = join(home, 'config.json')
  try { await readFile(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (legacyPath) {
      try { await writeConfigFile(path, await readConfigFile(legacyPath), { exclusive: true }) }
      catch (cause) { if (cause.code !== 'ENOENT' && cause.code !== 'EEXIST') throw cause }
    }
  }
  return { path, home, pinned: false }
}

export async function rememberConfig(location, path) {
  if (location.pinned) return
  await mkdir(location.home, { recursive: true })
  const target = join(location.home, 'location.json')
  await atomicWrite(target, `${JSON.stringify({ path }, null, 2)}\n`, { mode: 0o600 })
}
