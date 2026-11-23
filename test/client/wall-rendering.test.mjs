/** Client wall-rendering regression coverage. */
import test from 'node:test'
import { getTestApi, loadClient, CLIENT_SOURCE, captureNodes } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('Project 卡片按链接目标选底纹，别名与纸色不影响选择，普通卡片无底纹', (t) => {
  const { components } = loadClient(t).mod.__test
  const actions = { current: { t: (key) => key } }
  const render = (projects, paper, preview = false) => components.NoteCard({
    note: { path: '/vault/memo.md', projects }, actions, paper, preview,
  })
  const original = render('[[计划-项目]]')
  const tinted = render('[[计划-项目.md#进展|别名]]', { light: '#FDF5F6', dark: '#2E2426' }, true)
  assert.ok(original.props['data-texture'])
  assert.equal(tinted.props['data-texture'], original.props['data-texture'])
  assert.equal(tinted.props.style['--sn-card-bg'], '#FDF5F6')
  assert.equal(tinted.props.style['--sn-card-bg-dark'], '#2E2426')
  assert.equal(render(undefined).props['data-texture'], undefined)
  assert.equal(render('无项目链接').props['data-texture'], undefined)
})

test('点击只给当前卡片播放轻量缩小回弹，拖拽、预览及减少动态效果不播放', (t) => {
  const { components } = loadClient(t).mod.__test
  const note = { path: '/vault/memo.md' }, opened = [], animations = []
  const props = { note, actions: { current: { t: (key) => key, onOpen: (value) => opened.push(value) } } }
  let reduced = false
  const card = {
    ownerDocument: { defaultView: { matchMedia(query) {
      assert.equal(query, '(prefers-reduced-motion: reduce)')
      return { matches: reduced }
    } } },
    animate(frames, options) { animations.push({ frames, options }) },
  }
  const click = (extra, detail = 1) => components.NoteCard({ ...props, ...extra }).props.onClick({ currentTarget: card, detail })
  click()
  click({}, 2)
  click({ preview: true })
  click({ dragging: true })
  reduced = true
  click()
  assert.deepEqual(opened, [note, note], '减少动态效果不影响打开便签')
  assert.equal(animations.length, 1)
  assert.deepEqual(animations[0].frames.map((frame) => Number(frame.scale)), [1, .965, 1])
  assert.equal(animations[0].options.duration, 150)
})

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

test('标题、正文共享剩余高度；没有正文时不保留摘要位，评论与图片排在文字区下方', (t) => {
  const { components } = loadClient(t).mod.__test
  const render = (excerpt, images = []) => components.NoteCard({
    note: {
      path: 'a.md', title: '可以展开的便签标题', excerpt, images,
      commentGroups: [{ emoji: '😈', label: '毒舌', count: 2 }],
    },
    actions: { current: { t: (key) => key } },
  })
  const classNames = (node) => node.children.filter(Boolean).map((child) => child.props.className)
  for (const images of [[], [{ source: 'cover.png' }]]) {
    for (const body of ['', '一段正文']) {
      const card = render(body, images)
      const nodes = captureNodes(card)
      const clip = nodes.find((node) => node.props.className === 'SN_cardClip')
      const text = nodes.find((node) => node.props.className === 'SN_cardText')
      assert.equal(card.props['data-body'], String(Boolean(body)))
      assert.equal(card.props['data-images'], String(Boolean(images.length)))
      assert.deepEqual(classNames(text), body ? ['SN_cardHead', 'SN_cardExcerptSlot'] : ['SN_cardHead'])
      assert.deepEqual(classNames(clip).slice(0, images.length ? 3 : 2), images.length
        ? ['SN_cardText', 'SN_cardComments', 'SN_cardImages'] : ['SN_cardText', 'SN_cardComments'])
      assert.equal(nodes.some((node) => node.props.className === 'SN_cardExcerpt'), Boolean(body))
    }
  }
  assert.doesNotMatch(CLIENT_SOURCE, /card\.noExcerpt|暂无正文/)
  assert.match(CLIENT_SOURCE, /\.SN_card\[data-images='false'\]\[data-body='true'\] \.SN_cardText\{margin-bottom:14px\}/,
    '额外留白在文字区内部预算中，不应抬高评论条')
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
  // 卡片始终是普通箭头；只有工作空间标签在长按拖动时才临时用抓手光标。
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_card(?:\[[^\]]*\])?\{[^}]*cursor:grabb?ing/)
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_card(?:\[[^\]]*\])?\{[^}]*cursor:grab[;}]/)
  assert.match(CLIENT_SOURCE, /\.SN_wsTab\[data-dragging='true'\]\{[^}]*cursor:grabbing/, '标签长按拖动时才出现抓手光标')
  assert.match(CLIENT_SOURCE, /\.SN_card\{[^}]*cursor:default/)
  assert.doesNotMatch(CLIENT_SOURCE, /\.SN_card(?:\[[^\]]*\])?\{[^}]*cursor:pointer/)
})

test('卡片预览保留换行和编号，项目点及待办只替换标记为等大圆点', (t) => {
  const { components } = loadClient(t).mod.__test
  const note = { path: 'a.md', title: '标题', excerpt: '旧摘要 ☐ 待办 ☑ 完成',
    cardPreview: '第一行中的 ☑ 原样保留\n• 项目\n3) ☐ 待办\n☑ 完成\n4. 下一项' }
  const render = (patch) => captureNodes(components.NoteCard({
    note: { ...note, ...patch }, actions: { current: { t: (key) => key } },
  })).find((node) => node.props.className === 'SN_cardExcerpt')
  const multiline = render()
  const markers = (node) => captureNodes(node).filter((child) => child.props.className === 'SN_cardMarker')
  const textParts = (node) => node.children.flat().filter((child) => typeof child === 'string')
  assert.deepEqual(textParts(multiline), ['第一行中的 ☑ 原样保留\n', ' 项目\n3) ', ' 待办\n', ' 完成\n4. 下一项'])
  assert.deepEqual(markers(multiline).map((dot) => dot.props['data-kind']), ['bullet', 'todo', 'done'])
  assert.equal(markers(multiline)[0].props['aria-hidden'], 'true')
  assert.deepEqual(markers(multiline).slice(1).map((dot) => dot.props['aria-label']), ['card.task.todo', 'card.task.done'])
  assert.equal(multiline.props['data-compact'], 'false')
  const withImage = render({ images: [{ source: 'cover.png' }], imageCount: 1 })
  assert.equal(withImage.props['data-compact'], 'true')
  assert.deepEqual(markers(withImage).map((dot) => dot.props['data-kind']), ['todo', 'done'])
  assert.deepEqual(textParts(withImage), ['旧摘要 ', ' 待办 ', ' 完成'])
  assert.deepEqual(render({ excerpt: '纯文本', cardPreview: undefined }).children, ['纯文本'], '旧 Host 向后兼容')
  assert.match(CLIENT_SOURCE, /\.SN_cardExcerpt\[data-compact='false'\]\{white-space:pre-line/)
  assert.match(CLIENT_SOURCE, /\.SN_cardMarker\{[^}]*width:5px;height:5px;[^}]*background:var\(--sn-ink-muted\)/)
  assert.match(CLIENT_SOURCE, /\.SN_cardMarker:is\(\[data-kind='done'\],\[data-kind='todo'\]\)\{background:var\(--sn-accent\)/)
  assert.match(CLIENT_SOURCE, /\.SN_cardMarker\[data-kind='todo'\]\{opacity:\.5\}/)
})

test('v0.16.7 卡片评论：只显示 emoji + label + 加粗条数，不显示正文，点击打开面板', (t) => {
  const api = loadClient(t).mod.__test
  let opened = 0
  const actions = { current: { t: (key) => key, onOpen: () => opened++ } }
  const note = {
    path: 'a.md', title: '标题', excerpt: '',
    commentGroups: [
      { emoji: '😈', label: '毒舌', count: 2 },
      { emoji: '🌱', label: '落地', count: 1 },
      { emoji: '🔍', label: '洞察', count: 3 },
    ],
    comments: [{ emoji: '😈', label: '毒舌', text: '不应显示的评论正文' }],
    images: [],
  }
  const card = api.components.NoteCard({ note, emojis: [], actions, hoverActive: false, drawerOpen: false })
  const nodes = captureNodes(card)
  const groups = nodes.filter((node) => node.props.className === 'SN_cCommentGroup')
  assert.equal(groups.length, 2, '无图最多显示 2 类评论')
  assert.deepEqual(groups.map((group) => group.children.map((node) => node.children[0])), [
    ['😈', '毒舌', '2'],
    ['🌱', '落地', '1'],
  ])
  assert.equal(nodes.some((node) => node.props.className === 'SN_cCommentText'), false)
  assert.equal(nodes.some((node) => node.children.includes('不应显示的评论正文')), false)
  assert.equal(nodes.find((node) => node.props.className === 'SN_cCommentMore').children[0], 'card.moreCommentGroups')
  assert.equal(nodes.find((node) => node.props.className === 'SN_cCommentCount').children[0], '2')
  card.props.onClick({ detail: 1 })
  assert.equal(opened, 1)

  const withImages = api.components.NoteCard({
    note: { ...note, images: [{ source: 'a.png', alt: '', wiki: false }], imageCount: 1 },
    emojis: [], actions, hoverActive: false, drawerOpen: false,
  })
  const imageNodes = captureNodes(withImages)
  assert.equal(imageNodes.filter((node) => node.props.className === 'SN_cCommentGroup').length, 1, '有图时只显示 1 类')
  assert.equal(imageNodes.find((node) => node.props.className === 'SN_cCommentMore').children[0], 'card.moreCommentGroups')
})

test('v0.16.7 cardCommentGroups：优先 Host 汇总，旧 Host 回退按 comments 现算', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(api.cardCommentGroups({
    commentGroups: [{ emoji: '😈', label: '毒舌', count: 2 }, { bad: true }, { emoji: '', label: '', count: 4 }],
  }), [{ emoji: '😈', label: '毒舌', count: 2 }])
  assert.deepEqual(api.cardCommentGroups({
    comments: [
      { emoji: '😈', label: '毒舌' },
      { emoji: '😈', label: '毒舌' },
      { emoji: '', label: '笔记' },
    ],
  }), [{ emoji: '😈', label: '毒舌', count: 2 }, { emoji: '', label: '笔记', count: 1 }])
  assert.deepEqual(api.cardCommentGroups(null), [])
})

test('v0.16.8 sortNotes：name-asc 按展示标题排序（文件名模式下与 name 相同）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const notes = [
    { path: '/1', name: '2026-11-13-1924', title: '乙', created: 1 },
    { path: '/2', name: 'alpha', title: '甲', created: 2 },
  ]
  assert.deepEqual(api.sortNotes(notes, 'name-asc').map((note) => note.path), ['/2', '/1'])
  const filenameMode = [
    { path: '/b', name: '乙', title: '乙', created: 1 },
    { path: '/a', name: '甲', title: '甲', created: 2 },
  ]
  assert.deepEqual(api.sortNotes(filenameMode, 'name-asc').map((note) => note.path), ['/a', '/b'])
})

test('sortNotes：相同创建时间按路径打破平局，正文标题和修改时间不改变排序', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const a = { path: '/a.md', title: 'Z', created: 4, mtime: 5 }
  const b = { path: '/b.md', title: 'B', created: 4, mtime: 10 }
  assert.deepEqual(api.sortNotes([b, a], 'created-desc'), [a, b])
  assert.deepEqual(api.sortNotes([b, a], 'created-asc'), [a, b])
  assert.deepEqual(api.sortNotes([a, b], 'mtime-desc'), [b, a])
})
