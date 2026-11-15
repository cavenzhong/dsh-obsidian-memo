/**
 * 便签标题推导：文件名 / 正文第一行 / 正文第一个一级标题。
 * 纯函数、无 IO；与浏览器端 src/client/reader/title-line.js 保持同一套规则
 * （用 test-support/title-parity-fixtures.mjs 做 parity 测试）。
 * @module dsh-obsidian-memo/title
 */

import { INVISIBLE_CHARS, normalizeText, stripInline } from './markdown.js'

/** 三种标题模式；filename 为默认，保持 0.16.7 及以前的行为。 */
export const TITLE_MODES = ['filename', 'firstLine', 'heading']

export const DEFAULT_TITLE_MODE = 'filename'

const ATX = /^ {0,3}(#{1,6})\s+(.*)$/
const FENCE = /^\s*(```|~~~)(.*)$/
const FENCE_AT = /^(?:`{3,}|~{3,})/
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/

/** 模式规范化：未知值一律回退默认模式。 */
export function normalizeTitleMode(value) {
  return TITLE_MODES.includes(value) ? value : DEFAULT_TITLE_MODE
}

function noTitle() {
  return { title: '', index: -1, marker: '' }
}

/** 原始行（已 trim）是否是代码围栏或分隔线；用于避免把结构性行当成标题/置空。 */
function isFenceOrHr(text) {
  return FENCE_AT.test(text) || HR.test(text)
}

/**
 * 在正文行数组里定位标题行。
 * @param {string[]} lines - 已去 frontmatter、去 BOM、统一 `\n` 的正文行。
 * @param {'filename' | 'firstLine' | 'heading'} mode
 * @returns {{ title: string, index: number, marker: string }} 取不到时为 `{ title: '', index: -1, marker: '' }`
 */
export function findTitleLine(lines, mode) {
  const list = Array.isArray(lines) ? lines : []
  if (mode === 'firstLine') {
    for (let i = 0; i < list.length; i += 1) {
      const raw = String(list[i] ?? '').trim()
      if (raw === '') continue
      // 围栏/分隔线是结构行，不当作标题，也不置空（置空会破坏代码块语义）。
      if (isFenceOrHr(raw)) return noTitle()
      const atx = raw.match(ATX)
      if (atx) {
        const text = atx[2].trim()
        if (text.startsWith('\\') && isFenceOrHr(text.slice(1))) {
          return { title: text.slice(1), index: i, marker: atx[1] }
        }
        const title = stripInline(text)
        return title === '' ? noTitle() : { title, index: i, marker: atx[1] }
      }
      // 写回时对「看起来像围栏/分隔线」的标题加了一个反斜杠，这里逐字还原。
      if (raw.startsWith('\\') && isFenceOrHr(raw.slice(1))) {
        return { title: raw.slice(1), index: i, marker: '' }
      }
      const title = stripInline(raw)
      return title === '' ? noTitle() : { title, index: i, marker: '' }
    }
    return noTitle()
  }
  if (mode === 'heading') {
    let fence = ''
    for (let i = 0; i < list.length; i += 1) {
      const line = String(list[i] ?? '')
      const fenceMatch = line.match(FENCE)
      if (fence !== '') {
        if (fenceMatch && line.trim().startsWith(fence)) fence = ''
        continue
      }
      if (fenceMatch) {
        fence = fenceMatch[1]
        continue
      }
      const atx = line.match(ATX)
      if (!atx || atx[1].length !== 1) continue
      const text = atx[2].trim()
      const title = text.startsWith('\\') && isFenceOrHr(text.slice(1))
        ? text.slice(1)
        : stripInline(text)
      if (title !== '') return { title, index: i, marker: atx[1] }
    }
    return noTitle()
  }
  return noTitle()
}

/** 正文标题写回前的清洗：折叠换行、去掉不可见控制符、去首尾空白；不截断、不去 Markdown 记号。 */
export function sanitizeTitleText(value) {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, ' ')
    .replace(/\n/g, ' ')
    .replace(INVISIBLE_CHARS, '')
    .trim()
}

/**
 * 生成写回正文的标题行（单行，不含换行）。
 * @param {'filename' | 'firstLine' | 'heading'} mode
 * @param {string} title
 * @param {string} [marker] - 原行的 ATX 前缀（如 `##`），firstLine 模式用来保留格式。
 * @returns {string} filename 模式返回空串
 */
export function titleLineFor(mode, title, marker = '') {
  const clean = sanitizeTitleText(title)
  if (clean === '' || (mode !== 'firstLine' && mode !== 'heading')) return ''
  const escaped = isFenceOrHr(clean) ? `\\${clean}` : clean
  if (mode === 'heading') return `# ${escaped}`
  return marker ? `${marker} ${escaped}` : escaped
}

/** 从正文（不含 frontmatter）派生标题；取不到时返回空串。 */
export function deriveTitle(body, mode) {
  return findTitleLine(normalizeText(body).split('\n'), normalizeTitleMode(mode)).title
}

/**
 * 去掉正文里的标题行（复制全文用，避免标题出现两遍）。
 * @param {string} body - 不含 frontmatter 的正文。
 * @param {'filename' | 'firstLine' | 'heading'} mode
 * @returns {string}
 */
export function stripTitleLine(body, mode) {
  const text = normalizeText(body)
  const lines = text.split('\n')
  const found = findTitleLine(lines, mode)
  if (found.title === '' || found.index < 0) return text
  lines.splice(found.index, 1)
  return lines.join('\n').replace(/^\n+/, '')
}
