/** Client wall-rendering regression coverage. */
import test from 'node:test'
import { getTestApi, loadClient, CLIENT_SOURCE, captureNodes } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('client __test：便签墙首屏 50 张，触底每次再补 50 张（不超过总数）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.WALL_PAGE_SIZE, 50, '首屏/每批应为 50 张')
  assert.equal(api.nextVisibleCount(50, 120), 100)
  assert.equal(api.nextVisibleCount(100, 120), 120)
  // 已经到头 / 总数更少：不再增加
  assert.equal(api.nextVisibleCount(120, 120), 120)
  assert.equal(api.nextVisibleCount(50, 12), 12)
  assert.equal(api.nextVisibleCount(0, 120), 50)
  // 非法输入不抛错，按 0 / 50 处理
  assert.equal(api.nextVisibleCount(undefined, 120), 50)
  assert.equal(api.nextVisibleCount(50, undefined), 50)
  assert.equal(api.nextVisibleCount(50, 120, 10), 60)
})

test('client 源码 / 0.13.9：卡片没有正文时不渲染「暂无正文」占位', () => {
  assert.doesNotMatch(CLIENT_SOURCE, /card\.noExcerpt/, 'card.noExcerpt 文案应移除')
  assert.doesNotMatch(CLIENT_SOURCE, /暂无正文/, '不应再出现「暂无正文」')
  assert.match(CLIENT_SOURCE, /excerpt \? h\('p', \{/, '摘要有内容才渲染 <p>')
})

test('client 组件 / 0.13.9：NoteCard 无正文时不渲染摘要行，有正文时照常渲染', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const actions = {
    current: {
      t: (key) => key,
      onOpen: () => {},
      onPreset: () => {},
      onCardEnter: () => {},
      onCardLeave: () => {},
      onToggleArchive: () => {},
      onArchive: () => {},
      onProject: () => {},
      onOpenObsidian: () => {},
    },
  }
  const render = (excerpt) => {
    const card = api.components.NoteCard({
      note: { path: 'a.md', title: '标题', excerpt: excerpt, comments: [], commentCount: 0, images: [] },
      emojis: [],
      pending: null,
      hoverActive: false,
      archiveMenuOpen: false,
      targets: [],
      menuRef: { current: null },
      drawerOpen: false,
      actions: actions,
    })
    const classes = []
    const texts = []
    const walk = (node) => {
      if (node == null) return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node === 'object') {
        if (node.props && node.props.className) classes.push(String(node.props.className))
        walk(node.children)
      } else {
        texts.push(String(node))
      }
    }
    walk(card)
    return { classes: classes, texts: texts }
  }

  const empty = render('')
  assert.equal(empty.classes.includes('SN_cardExcerpt'), false, '没有正文时不应渲染摘要 <p>')
  assert.equal(empty.texts.some((text) => text.includes('暂无正文')), false, '没有正文时不应出现占位文案')

  const filled = render('一段正文')
  assert.equal(filled.classes.includes('SN_cardExcerpt'), true, '有正文时应渲染摘要 <p>')
  assert.ok(filled.texts.includes('一段正文'))
})

test('v0.16 卡片标签：不占标题行，仅随菜单激活显示在右上角', (t) => {
  const api = loadClient(t).mod.__test
  const note = { path: '/vault/note.md', title: '这是一个很长的标题，显示时不应被文件夹标签挤窄', tag: '一个长度较长的文件夹名称/用于/验证叠加显示', comments: [] }
  const actions = { current: { t: (key) => key } }
  const card = api.components.NoteCard({ note, emojis: [], actions, hoverActive: false })
  let nodes = captureNodes(card)
  const tag = nodes.find((node) => node.props.className === 'SN_cardTag')
  const head = nodes.find((node) => node.props.className === 'SN_cardHead')
  assert.equal(card.props['data-menu'], 'false')
  assert.equal(tag.children[0], note.tag)
  assert.deepEqual(head.children.map((node) => node.type), ['h3'])
  assert.match(CLIENT_SOURCE, /\.SN_card\[data-menu='true'\] \.SN_cardTagLayer\{opacity:1/)
  const active = api.components.NoteCard({ note, emojis: [], actions, hoverActive: true })
  assert.equal(active.props['data-menu'], 'true')
  const layer = nodes.find((node) => node.props.className === 'SN_cardTagLayer')
  assert.deepEqual(layer.children, [tag])
  assert.match(CLIENT_SOURCE, /\.SN_cardTagLayer\{[^}]*background:linear-gradient\(to bottom,[^}]*var\(--sn-note-bg\)/)
  assert.match(CLIENT_SOURCE, /\.SN_cardTag,\.SN_noteDrawerTag\{[^}]*color:var\(--sn-tag-ink\);background:var\(--sn-note-bg\)/)
  assert.doesNotMatch(CLIENT_SOURCE, /cursor:grabb?ing|cursor:grab[;}]/)
  assert.match(CLIENT_SOURCE, /\.SN_card\{[^}]*cursor:default/)
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_card(?:\[[^\]]*\])?\{[^}]*cursor:pointer/)
})
