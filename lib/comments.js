/**
 * 评论的派生操作：按类型汇总、按序号删除 callout。
 * 纯函数，供扫描摘要与 Host 写接口共用；解析规则仍由 notes.js 的 parseNote 提供。
 */
import { LIMITS } from './shared.js'
import { normalizeText, parseNote, splitFrontmatter } from './notes.js'

const CALLOUT_HEAD = /^\s*>\s*\[![A-Za-z0-9_-]+\]/

/**
 * 删除第 index 条评论 callout（0 基）。只删 callout 本体；相邻两个空行叠在一起时收掉一个。
 * 返回新文本和删除前的原文，供撤回时整份写回。
 * @param {string} text - md 原文。
 * @param {number} index - 评论序号（按文中顺序）。
 * @returns {{ text: string, before: string, comment: object } | null}
 */
export function removeCommentAt(text, index) {
  if (!Number.isInteger(index) || index < 0) return null
  const normalized = normalizeText(text)
  const parsed = parseNote(normalized, {
    maxComments: LIMITS.scanComments,
    maxBlocks: LIMITS.blocks,
    withRanges: true,
  })
  const comment = parsed.comments[index]
  if (!comment || !Number.isInteger(comment.startLine) || !Number.isInteger(comment.endLine)) return null
  const { body } = splitFrontmatter(normalized)
  const bodyOffset = normalized.length - body.length
  const bodyStartLine = bodyOffset === 0 ? 0 : normalized.slice(0, bodyOffset).split('\n').length - 1
  const lines = normalized.split('\n')
  const start = bodyStartLine + comment.startLine
  const end = bodyStartLine + comment.endLine
  if (start < 0 || end < start || end >= lines.length) return null
  if (!CALLOUT_HEAD.test(lines[start])) return null
  lines.splice(start, end - start + 1)
  // callout 前后原本各有一个空行时，删完会连成两个空行；只收掉一个。
  if (start > 0 && lines[start - 1]?.trim() === '' && lines[start]?.trim() === '') lines.splice(start, 1)
  const trimmed = lines.join('\n').replace(/\s+$/u, '')
  const bom = typeof text === 'string' && text.startsWith('\uFEFF') ? '\uFEFF' : ''
  return {
    before: typeof text === 'string' ? text : normalized,
    text: trimmed === '' ? `${bom}` : `${bom}${trimmed}\n`,
    comment,
  }
}

/**
 * 评论按 emoji + label 分组计数（按首次出现顺序），用于卡片上的类型汇总。
 * @param {{ emoji?: string, label?: string, title?: string }[]} comments
 * @returns {{ emoji: string, label: string, count: number }[]}
 */
export function commentGroupsFrom(comments) {
  const groups = []
  const byKey = new Map()
  for (const comment of Array.isArray(comments) ? comments : []) {
    const emoji = typeof comment?.emoji === 'string' ? comment.emoji : ''
    const label = typeof comment?.label === 'string' && comment.label !== ''
      ? comment.label
      : typeof comment?.title === 'string' ? comment.title : ''
    const key = `${emoji}\u0000${label}`
    const found = byKey.get(key)
    if (found) {
      found.count += 1
      continue
    }
    const group = { emoji, label, count: 1 }
    byKey.set(key, group)
    groups.push(group)
  }
  return groups.slice(0, LIMITS.emojis)
}
