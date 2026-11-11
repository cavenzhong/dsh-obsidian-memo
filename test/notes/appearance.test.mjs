import test from 'node:test'
import assert from 'node:assert/strict'
import { tagForRelativePath } from '../../lib/notes.js'
import { CARD_PALETTE, colorForTag, darkColorForTag } from '../../lib/shared.js'

test('colorForTag：无 tag 用纸白', () => {
  assert.equal(colorForTag(null), CARD_PALETTE[0].color)
  assert.equal(colorForTag(''), CARD_PALETTE[0].color)
  assert.equal(colorForTag(undefined), '#FDFAF4')
})

test('CARD_PALETTE：0.12 修正轮色板与契约 §3.5 完全一致（日间纸色再往白里调）', () => {
  assert.deepEqual(
    CARD_PALETTE.map((item) => [item.name, item.color, item.dark]),
    [
      ['纸白', '#FDFAF4', '#2C2721'],
      ['苔绿', '#F5F9F4', '#232B24'],
      ['杏', '#FDF7F3', '#2E2622'],
      ['雾蓝', '#F4F8FC', '#222A33'],
      ['藕荷', '#FAF5FA', '#2A242C'],
      ['米', '#FAF8F2', '#2B2822'],
      ['胭脂', '#FDF5F6', '#2E2426'],
      ['青瓷', '#F5F9F7', '#222C29'],
    ],
  )
  // 旧的 0.11 / 首版 0.12 纸色都不应再出现
  for (const stale of ['#FBF3DF', '#FCF7EC']) {
    assert.equal(CARD_PALETTE.some((item) => item.color === stale), false, `旧色 ${stale} 不应留在色板里`)
  }
})

test('colorForTag：同一 tag 恒定、都在色板内', () => {
  const palette = new Set(CARD_PALETTE.map((item) => item.color))
  const first = colorForTag('设计')
  for (let i = 0; i < 20; i += 1) assert.equal(colorForTag('设计'), first)
  assert.equal(palette.has(first), true)
  assert.equal(colorForTag('设计'), colorForTag('设计'))
})

test('colorForTag：不同 tag 会分到多种色（不是恒定一色）', () => {
  const tags = ['设计', '想法', '读书', '代码', '工作', '生活', '研究', '写作', '灵感', '会议']
  const colors = new Set(tags.map((tag) => colorForTag(tag)))
  assert.ok(colors.size >= 2, `期望至少两种颜色，实际 ${[...colors].join(',')}`)
})

test('colorForTag / darkColorForTag：同 tag 稳定、color/darkColor 来自同一色板项', () => {
  const darkByColor = new Map(CARD_PALETTE.map((item) => [item.color, item.dark]))
  for (const tag of [null, '', '设计', 'WORKING_NOW', '想法', '读书']) {
    const color = colorForTag(tag)
    const dark = darkColorForTag(tag)
    assert.match(color, /^#[0-9A-Fa-f]{6}$/)
    assert.match(dark, /^#[0-9A-Fa-f]{6}$/)
    assert.equal(darkByColor.get(color), dark, `${tag} 的 color 与 darkColor 必须是同一色板项`)
    // 同一 tag 多次调用稳定
    assert.equal(colorForTag(tag), color)
    assert.equal(darkColorForTag(tag), dark)
  }
  // 无 tag = 纸白 + 纸白暗色
  assert.equal(colorForTag(null), '#FDFAF4')
  assert.equal(darkColorForTag(null), '#2C2721')
  // 同一 tag 的两个便签必然同色（hex 成对）
  assert.deepEqual([colorForTag('设计'), darkColorForTag('设计')], [colorForTag('设计'), darkColorForTag('设计')])
})

test('tagForRelativePath：顶层 null、第一层子目录为 tag', () => {
  assert.equal(tagForRelativePath('a.md'), null)
  assert.equal(tagForRelativePath('WORKING_NOW/b.md'), 'WORKING_NOW')
  assert.equal(tagForRelativePath('WORKING_NOW/深层/c.md'), 'WORKING_NOW')
  assert.equal(tagForRelativePath(''), null)
})
