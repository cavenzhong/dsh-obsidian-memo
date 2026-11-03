/**
 * dsh-sticky-notes —— Host/Client 共享常量。
 *
 * 这里只放纯数据（无 Node 依赖），方便单独测试，也方便与浏览器半对齐。
 * @module dsh-sticky-notes/shared
 */

/** 包内 RPC 通道名（/^\/[A-Za-z0-9._~-]+$/）。 */
export const CHANNEL = '/sticky-notes'

/** 客户端 locale 命名空间。 */
export const NS = 'sticky-notes'

/** 卡片淡色板：索引 0 是"无 tag"的纸白，其余按 tag 稳定分配。 */
export const CARD_PALETTE = [
  { name: '纸白', color: '#FBF3DF', dark: '#2C2721' },
  { name: '苔绿', color: '#EEF3EA', dark: '#232B24' },
  { name: '杏', color: '#F6EDE7', dark: '#2E2622' },
  { name: '雾蓝', color: '#EBF1F7', dark: '#222A33' },
  { name: '藕荷', color: '#F4EDF4', dark: '#2A242C' },
  { name: '米', color: '#F3F0E4', dark: '#2B2822' },
  { name: '胭脂', color: '#F7EDEE', dark: '#2E2426' },
  { name: '青瓷', color: '#EDF3F0', dark: '#222C29' },
]

/** 允许的 callout 类型（Obsidian 内置）。 */
export const CALLOUT_TYPES = [
  'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
]

/** 默认四枚评论 emoji（设置里可改、可增删）。 */
export const DEFAULT_EMOJIS = [
  {
    id: 'insight',
    emoji: '🔍',
    label: '洞察',
    callout: 'quote',
    prompt: '你在读一张 Obsidian 便签。找出这条想法里 2–3 个最值得继续追的具体线索、隐含前提或盲点，不要复述原文，不要客套。中文，120 字以内。',
  },
  {
    id: 'extend',
    emoji: '💡',
    label: '延伸',
    callout: 'tip',
    prompt: '给一个能把这想法往前推一步的具体做法、变体或例子，必须具体到能动手，不要泛泛而谈。中文，120 字以内。',
  },
  {
    id: 'risk',
    emoji: '⚠️',
    label: '风险',
    callout: 'warning',
    prompt: '指出这条想法最大的风险、隐藏假设或最容易失败的地方，并给一句判断依据。中文，120 字以内。',
  },
  {
    id: 'next',
    emoji: '✅',
    label: '下一步',
    callout: 'success',
    prompt: '给出一个今天就能动手的最小下一步，必须是具体动作。中文，80 字以内。',
  },
]

/** 默认"开档"建档提示词：只输出 Markdown 正文。 */
export const DEFAULT_PROJECT_PROMPT = `你在帮我把一张「进行时」便签开档成可持续推进的项目文档。
只输出 Markdown 正文，不要输出 YAML frontmatter，不要包在代码围栏里。结构固定：

# 项目名（从便签里提炼，不超过 20 字）
> [!abstract] 一句话定位

## 诉求
## 现状与已知
## 调查与线索
## 下一步（3 条以内）
## 待确认的问题

要求：信息只能来自便签内容；不确定的东西写进「待确认的问题」，不要编造；用简洁中文；每个小节 1–3 句或 1–3 条，不要空话。`

/** Host 侧读取/写入上限。 */
export const LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxDepth: 5,
  summaryComments: 6,
  fullComments: 30,
  commentText: 2000,
  excerpt: 360,
  blocks: 200,
  blockText: 2000,
  llmCommentChars: 4000,
  projectNameChars: 60,
  emojis: 12,
  jobsTtlMs: 2 * 60 * 1000,
  undoTtlMs: 10 * 60 * 1000,
}

/** 允许的评论 callout 兜底。 */
export const FALLBACK_CALLOUT = 'note'

/** 判断一个值是否是普通对象。 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 把 tag 稳定映射到淡色板（空 tag = 纸白）。 */
export function colorForTag(tag) {
  return paletteForTag(tag).color
}

/** 同一 tag 的暗色模式卡片底色（深色底、同一色相）。 */
export function darkColorForTag(tag) {
  return paletteForTag(tag).dark
}

function paletteForTag(tag) {
  if (!tag) return CARD_PALETTE[0]
  let hash = 0
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.codePointAt(i)) >>> 0
  return CARD_PALETTE[1 + (hash % (CARD_PALETTE.length - 1))]
}

/** 本地时间戳：`YYYY-MM-DD HH:mm`。 */
export function localStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
