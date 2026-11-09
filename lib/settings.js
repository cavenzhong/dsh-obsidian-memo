/**
 * dsh-sticky-notes —— 设置：默认值、规范化、读写。
 *
 * 设置只存在插件自己的 `data/settings.json`（不写 profile patch，也不写 Obsidian 仓库）。
 * `Config` 只为在 cordis.patch.yml 里给首启提供默认值；文件优先。
 * @module dsh-sticky-notes/settings
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, basename, isAbsolute, normalize, resolve } from 'node:path'
import {
  CALLOUT_TYPES, DEFAULT_AI, DEFAULT_EMOJIS, DEFAULT_PROJECT_PROMPT, FALLBACK_CALLOUT, LIMITS,
  isLegacyDefaultEmojis, isPlainObject, normalizeAi, normalizeImageCompression, DEFAULT_IMAGE_COMPRESSION,
} from './shared.js'

/** 首次运行时的设置。 */
export const DEFAULT_SETTINGS = {
  vaultPath: '',
  notesDir: '',
  projectDir: '',
  attachmentDir: '',
  archiveTargets: [],
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
  let vaultPath = resolveUserPath(source.vaultPath ?? DEFAULT_SETTINGS.vaultPath, options.vaultPath ?? '')
  vaultPath = vaultPath && isAbsolute(vaultPath) ? vaultPath : vaultPath
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
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(tmp, filePath)
  return normalized
}

/** 两个设置是否等价（用于决定是否重扫）。 */
export function settingsEqual(a, b) {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b))
}
