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

/**
 * 卡片淡色板：索引 0 是"无 tag"的纸白，其余按 tag 稳定分配。
 * 0.12：日间纸色整体提亮一档（用户反馈"日间卡片颜色更淡些"）；深色纸不变。
 */
export const CARD_PALETTE = [
  { name: '纸白', color: '#FCF7EC', dark: '#2C2721' },
  { name: '苔绿', color: '#F1F6EF', dark: '#232B24' },
  { name: '杏', color: '#FBF3EE', dark: '#2E2622' },
  { name: '雾蓝', color: '#F0F5FB', dark: '#222A33' },
  { name: '藕荷', color: '#F8F1F8', dark: '#2A242C' },
  { name: '米', color: '#F8F5EC', dark: '#2B2822' },
  { name: '胭脂', color: '#FBF1F2', dark: '#2E2426' },
  { name: '青瓷', color: '#F1F7F4', dark: '#222C29' },
]

/** 允许的 callout 类型（Obsidian 内置）。 */
export const CALLOUT_TYPES = [
  'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
]

/**
 * 0.12 的四个默认 AI 评论人格（设置里可改、可增删）。
 * 设计目标：四枚要有鲜明差异，而不是四种"正确答案"。
 *  - 😈 毒舌：尖锐黑色幽默，好笑、像金句，但不为刻薄而刻薄；
 *  - ✨ 另一面：从没想过的角度切入 + 人文关怀，让人被看见；
 *  - 🧭 落地：务实判断，证据链 + 最省力下一步，惜字如金；
 *  - 😇 真心话：贴心伙伴，给回信心与一个轻起手。
 */
export const DEFAULT_EMOJIS = [
  {
    id: 'devil',
    emoji: '😈',
    label: '毒舌',
    callout: 'quote',
    prompt: `你是一个嘴毒但心热的老朋友。读这张便签，先挑出它最荒诞、最值得被调侃的那一点，用一句真正好笑的黑色幽默点破——要妙、要像金句，不要为了刻薄而硬造段子。笑完，再用一两句说出真正该看清的事。

规则：
- 如果这是专业问题（医疗、法律、财务、工程、安全等），玩笑之后必须提醒对方去找专业人士，不要给结论性建议；
- 如果这是写作或创作，收起毒舌，换成"大哥"的口吻：直接讲一句对他写作真正有用的话；
- 不堆表情、不人身攻击、不说教。中文，120 字以内。`,
  },
  {
    id: 'another',
    emoji: '✨',
    label: '另一面',
    callout: 'abstract',
    prompt: `先放下便签作者自己的视角，从一件他完全没提过的东西切入——另一个人的处境、十年后的自己、一个看似无关的领域——给出一个他大概率没想过的角度。

然后回到人本身：这句话背后可能藏着的情绪、在意或疲惫，用一两句轻轻说中，让他觉得被看见、被理解。

要求：
- 角度必须具体、能接着往下想，不要说"换个角度想"这种空话；
- 不空洞共情（不要"我理解你""抱抱"），不喊口号，不强行升华；
- 中文，130 字以内。`,
  },
  {
    id: 'grounded',
    emoji: '🧭',
    label: '落地',
    callout: 'info',
    prompt: `你是一个干练、务实的落地顾问，惜字如金。读这张便签，只给能直接影响行动的判断：

1）一句话结论：这事该不该做、值不值得推进；
2）证据链：2–3 条最有分量的事实或高置信推测，明确标出哪些是推测、以及推断依据；
3）最省力的下一步：一个具体动作，加一个能判断是否走通的验证信号。

禁止：罗列"我分析了/我查了"式的工作量，把常识当洞察，说"要重视/要规划"这类空话，列超过 3 个并列点。信息不足就直说缺哪一条关键信息，不要猜。中文，120 字以内。`,
  },
  {
    id: 'truth',
    emoji: '😇',
    label: '真心话',
    callout: 'success',
    prompt: `你是那个会说真话、也永远站在他这边的伙伴。读这张便签：
- 先接住他此刻的状态，要具体，不要套话；
- 再指出这件事里他已经做对的一个小地方，要真、要具体；
- 最后给一句不带压力的鼓励，和一个几乎不费力的起手动作，让他愿意继续。

语气舒服、松弛，像深夜聊天；可以幽默，但不要鸡汤，不夸张，不替他承诺结果。中文，100 字以内。`,
  },
]

/**
 * 0.11 及更早的默认四枚评论 emoji（原样保留，供设置迁移判断）。
 * 只有当用户的 emojis 与这份默认值**完全一致**时才自动换成 0.12 默认值，
 * 用户改过的预设一律不碰。
 */
export const LEGACY_EMOJIS = [
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

/** 旧默认预设是否为原样未改（id / emoji / label / callout / prompt 全一致）。 */
export function isLegacyDefaultEmojis(emojis) {
  if (!Array.isArray(emojis) || emojis.length !== LEGACY_EMOJIS.length) return false
  return emojis.every((item, index) => {
    if (!isPlainObject(item)) return false
    const legacy = LEGACY_EMOJIS[index]
    return item.id === legacy.id
      && item.emoji === legacy.emoji
      && item.label === legacy.label
      && item.callout === legacy.callout
      && item.prompt === legacy.prompt
  })
}

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
  scanComments: 200, // 扫描时为 commentKinds 解析的评论条数上限（覆盖"全部评论"的典型场景）
  commentText: 2000,
  excerpt: 360,
  blocks: 200,
  blockText: 2000,
  llmCommentChars: 4000,
  projectNameChars: 60,
  emojis: 12,
  cardImages: 3, // 卡片缩略图最多下发几张（第 4 张起只给数量）
  cardImageMaxBytes: 1_500_000, // 卡片缩略图读取上限，超过就不加载（阅读模式仍可看原图）
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
