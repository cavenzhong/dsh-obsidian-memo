/** Project Markdown and model response protocol. No filesystem mutations here. */
import { LIMITS } from './shared.js'

export const projectSuffix = '-项目.md'
export function projectName(input) {
  return String(input ?? '').replace(/(?:-项目)?\.md$/iu, '').replace(/-项目$/u, '').replace(/[\u0000-\u001f\\/:*?"<>|#^[\]]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().replace(/^\.+|\.+$/gu, '').slice(0, LIMITS.projectNameChars).trim()
}
export function projectWikilink(path, alias) {
  const target = String(path).replace(/\.md$/iu, '')
  const label = String(alias || '').replace(/[|\[\]\r\n]/gu, ' ').trim().slice(0, 60)
  return `[[${target}${label ? `|${label}` : ''}]]`
}
export function parseCheck(text, candidates) {
  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/iu)
  const candidate = fenced ? fenced[1].trim() : String(text || '').trim()
  let result
  try { result = JSON.parse(candidate) } catch { return { name: '新项目', level: '尚可', reason: 'AI 未按 JSON 返回；请人工确认这件事是否值得持续跟踪。', matches: [], candidates } }
  if (!['不建议', '尚可', '符合'].includes(result?.level) || typeof result.reason !== 'string' || !result.reason.trim() || typeof result.name !== 'string' || !projectName(result.name)) return { name: '新项目', level: '尚可', reason: 'AI 判断格式不完整；请人工确认后再建立项目。', matches: [], candidates }
  const matches = Array.isArray(result.matches) ? result.matches : []
  return { name: projectName(result.name).slice(0, 24), level: result.level, reason: result.reason.trim().slice(0, 120), matches: [...new Set(matches.filter((v) => candidates.includes(v)))], candidates }
}
