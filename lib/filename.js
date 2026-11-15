/**
 * 便签文件名的唯一规范化入口：新建（capture）与编辑改名（saveNote）共用同一套规则。
 * 只处理文件名本体（不含 .md），不负责路径边界与重名检查。
 * 0.16.8 起还负责「标题在正文」模式的自动文件名：模板展开、清洗、按字节截断。
 * @module dsh-obsidian-memo/filename
 */

import { formatTemplateMoment } from './datetime.js'
import { LIMITS } from './shared.js'

// 路径分隔符 / Windows 保留字符 / Markdown 链接特殊字符 / C0 控制符 / 零宽与双向控制符 / BOM。
const INVALID_NAME_CHARS = /[\\/:*?"<>|#^[\]\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g
// Windows 会忽略基础名尾随空格并截断扩展名；这里按第一个点前的基础名判断。
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/

/** 标题在正文的模式下，自动文件名模板的 token。 */
export const FILE_NAME_TOKENS = ['{title}', '{date}', '{time}', '{timestamp}']

export const DEFAULT_FILE_NAME_PATTERN = '{date}-{time}'

/**
 * 规范化便签文件名。
 * @param {unknown} raw - 用户输入（可含扩展名、空白、控制字符）。
 * @param {number} [maxBytes] - UTF-8 字节上限，默认 `LIMITS.noteNameBytes`。
 * @returns {{ name: string, error: 'empty' | 'reserved' | 'too-long' | null }}
 */
export function sanitizeNoteFileName(raw, maxBytes = LIMITS.noteNameBytes) {
  let name = String(raw ?? '')
    .normalize('NFC')
    .replace(INVALID_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // 先 trim 再删首尾点/空格，避免 " .foo" 变成隐藏文件 " .foo"。
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '').trim()
  if (name === '') return { name, error: 'empty' }
  const base = name.split('.')[0].trim().toUpperCase()
  if (WINDOWS_RESERVED.test(base)) return { name, error: 'reserved' }
  if (Buffer.byteLength(name, 'utf8') > maxBytes) return { name, error: 'too-long' }
  return { name, error: null }
}

/** 按 UTF-8 字节在码点边界截断文件名，并清掉截断后可能出现的尾随点/空格。 */
export function truncateNoteName(name, maxBytes = LIMITS.noteNameBytes) {
  let output = ''
  let bytes = 0
  for (const char of String(name ?? '')) {
    const size = Buffer.byteLength(char, 'utf8')
    if (bytes + size > maxBytes) break
    output += char
    bytes += size
  }
  return output.replace(/[. ]+$/, '').trim()
}

/**
 * 展开文件名模板；未知 `{...}` 与普通文字原样保留。
 * @param {string} pattern
 * @param {{ title?: string, now?: Date }} [options]
 * @returns {string}
 */
export function expandFileNamePattern(pattern, options = {}) {
  const source = typeof pattern === 'string' && pattern.trim() !== '' ? pattern : DEFAULT_FILE_NAME_PATTERN
  const title = typeof options.title === 'string' ? options.title : ''
  const now = options.now instanceof Date ? options.now : new Date()
  return source.replace(/\{(title|date|time|timestamp)\}/g, (_, token) => {
    if (token === 'title') return title
    if (token === 'date') return formatTemplateMoment(now, 'YYYY-MM-DD')
    if (token === 'time') return formatTemplateMoment(now, 'HHmm')
    return formatTemplateMoment(now, 'YYYYMMDD-HHmmss')
  })
}

/**
 * 生成一键新建时使用的文件名（不含 .md）：展开 → 清洗 → 截断/回退。
 * @param {string} pattern
 * @param {{ title?: string, now?: Date }} [options]
 * @returns {string}
 */
export function buildCaptureFileName(pattern, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const check = sanitizeNoteFileName(expandFileNamePattern(pattern, { ...options, now }))
  if (check.error === 'empty') return `note-${formatTemplateMoment(now, 'YYYYMMDD-HHmmss')}`
  if (check.error === 'reserved') {
    const prefixed = sanitizeNoteFileName(`note-${check.name}`)
    return prefixed.error === 'too-long' ? truncateNoteName(prefixed.name) : prefixed.name
  }
  if (check.error === 'too-long') return truncateNoteName(check.name)
  return check.name
}
