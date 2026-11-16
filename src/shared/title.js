/**
 * 便签标题推导：文件名 / 正文第一行 / 正文第一个一级标题。
 * Host 与 Client 共用纯函数；读取仅派生展示数据，编辑只返回草稿字符串。
 * @module dsh-obsidian-memo/title
 */

import {
  INVISIBLE_CHARS, normalizeText, stripInline, openingFence, closesFence, inlineImages, trailingBlockIds,
} from './markdown.js'
import { DEFAULT_TITLE_MODE, TITLE_MODES } from './note-rules.js'

export { DEFAULT_TITLE_MODE, TITLE_MODES } from './note-rules.js'

const ATX = /^ {0,3}(#{1,6})\s+(.*)$/
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
    let fence = null
    for (let i = 0; i < list.length; i += 1) {
      const line = String(list[i] ?? '')
      if (fence !== null) {
        if (closesFence(line, fence)) fence = null
        continue
      }
      fence = openingFence(line)
      if (fence !== null) continue
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
  // 首行输入自带 ATX 前缀时只使用一次，不再叠加源行的前缀。
  if (ATX.test(clean)) return clean
  return marker ? `${marker} ${escaped}` : escaped
}

/** 一轮标题输入使用同一个正文快照；中间态不重新定位到下一段。 */
export function createTitleEdit(body, mode) {
  const text = String(body ?? '')
  const normalized = normalizeTitleMode(mode)
  return { body: text, mode: normalized, source: findTitleLine(normalizeText(text).split('\n'), normalized) }
}

/** 标题的图片与 block id 属于源内容，改标题时仍保留。 */
function lineAttachments(line, replacement = '') {
  const images = [...inlineImages(line)].map((match) => match[0]).filter((image) => !replacement.includes(image))
  const ids = trailingBlockIds(line).trim()
  if (ids && !replacement.endsWith(ids)) images.push(ids)
  return images.join(' ')
}

/** 仅改变用户编辑的源行；返回原文表示无需保存，不修改编辑快照。 */
export function applyTitleEdit(edit, title) {
  if (edit.mode === 'filename') return edit.body
  const clean = sanitizeTitleText(title)
  const { source } = edit
  if (clean === sanitizeTitleText(source.title)) return edit.body
  // 分隔符单独保留，只替换目标行；保留未编辑行的 CRLF、空白和 BOM。
  const bom = edit.body.startsWith('\uFEFF') ? '\uFEFF' : ''
  const parts = edit.body.slice(bom.length).split(/(\r\n|\r|\n)/)
  const line = titleLineFor(edit.mode, clean, source.marker)
  if (source.index < 0) {
    if (line) parts.unshift(line, edit.body.match(/\r\n|\r|\n/)?.[0] || '\n')
  } else {
    const offset = source.index * 2
    const attachments = lineAttachments(parts[offset], line)
    const replacement = [line, attachments].filter(Boolean).join(' ')
    if (replacement) parts[offset] = replacement
    else parts.splice(offset, 2)
  }
  return bom + parts.join('')
}

/** 单次替换的兼容入口；连续输入请复用 createTitleEdit 返回的快照。 */
export function replaceTitleLine(body, mode, title) {
  return applyTitleEdit(createTitleEdit(body, mode), title)
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
  const attachments = lineAttachments(lines[found.index])
  if (attachments) lines[found.index] = attachments
  else lines.splice(found.index, 1)
  return lines.join('\n').replace(/^\n+/, '')
}
