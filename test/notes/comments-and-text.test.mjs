import test from 'node:test'
import assert from 'node:assert/strict'
import { commentGroupsFrom, removeCommentAt } from '../../lib/comments.js'
import {
  appendComment, buildCommentCallout, clip, commentKindsFrom, parseNote, stripBlockIds, stripInline,
} from '../../lib/notes.js'

test('buildCommentCallout：标题与正文格式', () => {
  const block = buildCommentCallout({ type: 'quote', title: '🔍 洞察 · 2026-11-03 22:10', text: '评论正文' })
  assert.equal(block, '> [!quote] 🔍 洞察 · 2026-11-03 22:10\n> 评论正文')
})

test('buildCommentCallout：多段正文空行写成 >', () => {
  const block = buildCommentCallout({ type: 'tip', title: '标题', text: '一\n\n二' })
  assert.equal(block, '> [!tip] 标题\n> 一\n>\n> 二')
})

test('appendComment：追加到文件末尾（空行分隔）', () => {
  const result = appendComment('# T\n\n正文\n', { type: 'quote', title: '🔍 洞察', text: '评论' })
  assert.equal(result, '# T\n\n正文\n\n> [!quote] 🔍 洞察\n> 评论\n')
})

test('appendComment：空文件只写评论块', () => {
  const result = appendComment('', { type: 'quote', title: '🔍 洞察', text: '评论' })
  assert.equal(result, '> [!quote] 🔍 洞察\n> 评论\n')
})

test('appendComment：多次追加按顺序累积', () => {
  let text = '# T\n\n正文\n'
  text = appendComment(text, { type: 'quote', title: '一', text: '第一条' })
  text = appendComment(text, { type: 'tip', title: '二', text: '第二条' })
  assert.equal(
    text,
    '# T\n\n正文\n\n> [!quote] 一\n> 第一条\n\n> [!tip] 二\n> 第二条\n',
  )
  const parsed = parseNote(text)
  assert.deepEqual(parsed.comments.map((comment) => comment.type), ['quote', 'tip'])
  assert.deepEqual(parsed.comments.map((comment) => comment.text), ['第一条', '第二条'])
})

test('appendComment：中文与多行评论都能被 parseNote 读回', () => {
  const result = appendComment('# T', { type: 'warning', title: '⚠️ 风险 · 2026-11-03 22:10', text: '第一段\n\n第二段' })
  const comment = parseNote(result).comments[0]
  assert.equal(comment.type, 'warning')
  assert.equal(comment.emoji, '⚠️')
  assert.equal(comment.label, '风险')
  assert.equal(comment.time, '2026-11-03 22:10')
  assert.equal(comment.text, '第一段\n\n第二段')
})

test('commentKindsFrom：评论 emoji 去重、按出现顺序、空 emoji 不计', () => {
  assert.deepEqual(
    commentKindsFrom([
      { emoji: '😈' },
      { emoji: '' },
      { emoji: '🔍' },
      { emoji: '😈' },
      {},
      { emoji: '⚠️' },
    ]),
    ['😈', '🔍', '⚠️'],
  )
  assert.deepEqual(commentKindsFrom(null), [])
  assert.deepEqual(commentKindsFrom([]), [])
})

test('stripInline：常见 markdown 记号清理', () => {
  assert.equal(stripInline('**粗** _斜_ ~~删~~ ==高亮== `代码`'), '粗 斜 删 高亮 代码')
  assert.equal(stripInline('[[a/b|别名]] 和 [[c/d]] 和 [[x#标题|带标题]]'), '别名 和 d 和 带标题')
  assert.equal(stripInline('![图](a.png) ![[嵌入]] [文字](https://x)'), '文字')
  assert.equal(stripInline('%%注释%% 正文 <span>标签</span>'), '正文 标签')
  assert.equal(stripInline('正文 ^block-id'), '正文')
})

test('stripInline / parseNote：0.13.9 隐藏行尾 block id 只去掉锚点，不吞掉它后面的文字', () => {
  // Obsidian block id 只出现在行尾：行尾锚点被删掉，锚点后面的下一行文字完整保留。
  assert.equal(stripInline('前文 ^qa-daily-preview-1e5t8lm'), '前文')
  assert.equal(stripInline('前文 ^qa-daily-preview-1e5t8lm\n后面的文字'), '前文\n后面的文字')
  assert.equal(stripInline('^qa-daily-preview-1e5t8lm'), '')
  assert.equal(stripBlockIds('第一行 ^id\n第二行 ^id-2\n第三行'), '第一行\n第二行\n第三行')
  assert.equal(stripBlockIds('连写锚点 ^id-1 ^id-2'), '连写锚点')

  // 行中/行首的 `^token` 不是 Obsidian 锚点，不能误删（否则会吞掉行内代码或上标）。
  assert.equal(stripInline('前文 ^id-1 中间 ^id-2 结尾'), '前文 ^id-1 中间 ^id-2 结尾')
  assert.equal(stripInline('说明里用 `^abc` 表示锚点'), '说明里用 ^abc 表示锚点')
  assert.equal(stripInline('代码 `x ^2` 与 `^block-id` 保留'), '代码 x ^2 与 ^block-id 保留')
  assert.equal(stripInline('求和公式 x ^2 加 y'), '求和公式 x ^2 加 y')
  assert.equal(stripInline('上标在行尾 x^2'), '上标在行尾 x^2')
  assert.equal(stripInline('^This 是行首'), '^This 是行首')
  assert.equal(stripInline('前文 ^qa-daily-preview-1e5t8lm。'), '前文 ^qa-daily-preview-1e5t8lm。')

  const parsed = parseNote([
    '# 标题 ^qa-daily-preview-1e5t8lm',
    '',
    '第一行 ^qa-daily-preview-1e5t8lm',
    '第二行继续',
    '',
    '- 列表项 ^qa-daily-preview-9x',
    '- 下一条',
    '',
    '> [!note] 评论',
    '> 评论正文 ^qa-daily-preview-1e5t8lm',
  ].join('\n'))
  assert.equal(parsed.title, '标题')
  assert.deepEqual(parsed.blocks.map((block) => block.text), ['标题', '第一行 第二行继续', '列表项', '下一条'])
  assert.match(parsed.excerpt, /第一行 第二行继续/)
  assert.doesNotMatch(parsed.excerpt, /qa-daily-preview/)
  assert.equal(parsed.comments.length, 1)
  assert.equal(parsed.comments[0].text, '评论正文')
})

test('commentGroupsFrom：按 emoji+label 分组计数，空 emoji 也归组', () => {
  assert.deepEqual(
    commentGroupsFrom([
      { emoji: '😈', label: '毒舌' },
      { emoji: '🌱', label: '落地' },
      { emoji: '😈', label: '毒舌' },
      { emoji: '', label: '笔记' },
      { emoji: '', label: '笔记' },
    ]),
    [
      { emoji: '😈', label: '毒舌', count: 2 },
      { emoji: '🌱', label: '落地', count: 1 },
      { emoji: '', label: '笔记', count: 2 },
    ],
  )
  assert.deepEqual(commentGroupsFrom([{ emoji: '🔍', title: '洞察' }]), [{ emoji: '🔍', label: '洞察', count: 1 }])
  assert.deepEqual(commentGroupsFrom(null), [])
})

test('removeCommentAt：按序号删 callout 与多余空行，保留其余评论', () => {
  const text = '# T\n\n正文\n\n> [!quote] 😈 毒舌 · 2026-11-13 10:00\n> 第一条\n\n> [!tip] 🌱 落地 · 2026-11-13 10:05\n> 第二段\n>\n> 续\n'
  const ranges = parseNote(text, { withRanges: true }).comments
  assert.equal(ranges[0].startLine, 4)
  assert.equal(ranges[0].endLine, 5)
  assert.equal(ranges[1].startLine, 7)
  assert.equal(ranges[1].endLine, 10)

  const first = removeCommentAt(text, 0)
  assert.equal(first.before, text)
  assert.equal(first.comment.title, '😈 毒舌 · 2026-11-13 10:00')
  assert.equal(first.text, '# T\n\n正文\n\n> [!tip] 🌱 落地 · 2026-11-13 10:05\n> 第二段\n>\n> 续\n')

  const second = removeCommentAt(text, 1)
  assert.equal(second.text, '# T\n\n正文\n\n> [!quote] 😈 毒舌 · 2026-11-13 10:00\n> 第一条\n')

  // 越界 / 非法序号不返回结果。
  assert.equal(removeCommentAt(text, 2), null)
  assert.equal(removeCommentAt(text, -1), null)
  assert.equal(removeCommentAt(text, 0.5), null)
})

test('removeCommentAt：保留 BOM 与 frontmatter，撤回用原文', () => {
  const text = '\uFEFF---\nPROJECTS: x\n---\n\n# T\n\n> [!note] A\n> a\n'
  const removed = removeCommentAt(text, 0)
  assert.equal(removed.text, '\uFEFF---\nPROJECTS: x\n---\n\n# T\n')
  assert.equal(removed.before, text)
  assert.deepEqual(parseNote(removed.text).blocks.map((block) => block.text), ['T'])
})

test('clip：短文本原样，长文本截断加省略号', () => {
  assert.equal(clip('abc', 5), 'abc')
  assert.equal(clip('abcdef', 3), 'abc…')
})
