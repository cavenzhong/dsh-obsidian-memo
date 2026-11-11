/** client: settings-ui regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_SOURCE, PACKAGE_JSON, captureNodes, getTestApi, hookRunner, loadClient } from '../../test-support/client.mjs'

test('mergeState：任务变化保留未变化卡片和设置对象', (t) => {
  const api = loadClient(t).mod.__test
  const state = { configured: true, revision: 'first', notes: [{ path: '/A.md', title: '甲', pending: null }], settings: { emojis: [] }, jobs: [] }
  const first = api.mergeState(null, state)
  const next = api.mergeState(first, JSON.parse(JSON.stringify({ ...state, revision: 'job-changed', jobs: [{ id: 'job', status: 'done' }] })))
  assert.equal(next.notes[0], first.notes[0])
  assert.equal(next.settings, first.settings)
})

test('面板 hook：组合数据、抽屉与设置职责后可以挂载和卸载', (t) => {
  const runner = hookRunner(t)
  const panel = runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key })
  assert.equal(panel.props.className, 'SN_panel')
})

test('client 源码：顶栏只显示版本，项目署名归入共享设置页', () => {
  // v0.13：BYLINE 常量已删除，版本从 Host 的 state.version 派生（旧 Host 才回退 APP_VERSION）。
  assert.doesNotMatch(CLIENT_SOURCE, /\bBYLINE\b/, 'BYLINE 常量应已删除（版本改由 state.version 派生）')
  assert.match(CLIENT_SOURCE, /SN_headByline' }, formatVersionLabel/, '顶栏只显示实际版本')
  assert.doesNotMatch(CLIENT_SOURCE, /SN_headByline'[^\n]*by caven/)
  assert.match(CLIENT_SOURCE, /SN_drawerSection SN_about/)
  assert.doesNotMatch(CLIENT_SOURCE, /SN_settingsCredit/)
  assert.doesNotMatch(CLIENT_SOURCE, /by caven V/, '旧文案 by caven V0.12 不应保留')
  // 只检查代码里的字符串字面量（注释里可以出现版本说明）；写死版本会被这条拦住
  assert.doesNotMatch(CLIENT_SOURCE, /['"]by caven v\d/, 'byline 不应写死版本号，应由 state.version 派生')
  // 渲染时应由 formatVersionLabel(view.version) 派生（不绑定具体拼接/模板写法）
  assert.match(CLIENT_SOURCE, /formatVersionLabel\(view\.version\)/, 'byline 应由 state.version 派生')
  // 只在顶栏出现：顶栏 byline span 有且只有一个渲染点，卡片/抽屉没有 byline 类名
  const headBylineSites = (CLIENT_SOURCE.match(/SN_headByline/g) ?? []).length
  assert.ok(headBylineSites >= 1, '顶栏应有 byline 渲染点')
  assert.doesNotMatch(CLIENT_SOURCE, /SN_noteDrawerByline|SN_cardByline|SN_byline\b/)
})

test('client 字典：0.13.8 新文案（在 Obsidian 打开 / 加载中 / callout 样式）中英文齐全', (t) => {
  const api = getTestApi(loadClient(t).mod)
  for (const key of ['card.obsidian', 'panel.loadingMore', 'settings.callout', 'settings.calloutValue']) {
    assert.equal(typeof api.dictionaries.zh[key], 'string', `zh 缺少 ${key}`)
    assert.notEqual(api.dictionaries.zh[key], '', `zh ${key} 不应为空`)
    assert.equal(typeof api.dictionaries.en[key], 'string', `en 缺少 ${key}`)
    assert.notEqual(api.dictionaries.en[key], '', `en ${key} 不应为空`)
  }
  assert.equal(api.dictionaries.zh['card.obsidian'], '在 Obsidian 打开')
  assert.match(api.dictionaries.zh['settings.calloutValue'], /\{style\}/, 'callout 样式文案应包含 {style} 插值')
  assert.match(api.dictionaries.en['settings.calloutValue'], /\{style\}/)
})

test('client StyleSelect：按钮显示「callout样式-xx」，点开菜单 13 项并给当前项打勾', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const t2 = (key, params) => {
    if (params && params.style) return 'callout样式-' + params.style
    const callout = /^callout\.(.+)$/.exec(key)
    if (callout) return ({ quote: '引用', note: '笔记' })[callout[1]] || callout[1]
    return key
  }
  const collect = (node, out = []) => {
    if (node == null) return out
    if (Array.isArray(node)) {
      for (const item of node) collect(item, out)
      return out
    }
    if (typeof node === 'object') {
      out.push(node)
      collect(node.children, out)
    }
    return out
  }
  const tree = api.components.StyleSelect({ t: t2, value: 'quote', disabled: false, onChange: () => {} })
  const nodes = collect(tree)
  const button = nodes.find((node) => node && node.type === 'button' && node.props && node.props['aria-haspopup'] === 'menu')
  assert.ok(button, '样式按钮缺失')
  assert.equal(button.props.title, 'callout样式-引用')
  assert.equal(button.children[0].children[0], 'callout样式-引用')
  // 未点开时没有菜单；菜单项由 CALLOUT_IDS 驱动（13 项），打开后当前项带 ✓。
  assert.equal(nodes.some((node) => node && node.props && node.props.role === 'menuitemradio'), false)
})

test('v0.16 设置：四分类与横向 Emoji 标签切换，末尾加号不随列表滚动', (t) => {
  const runner = hookRunner(t)
  const draft = { vaultPath: '/vault', notesDir: '/vault/notes', emojis: [
    { id: 'one', emoji: '😈', label: '甲', prompt: '第一份' }, { id: 'two', emoji: '✨', label: '乙', prompt: '第二份' },
  ] }
  const props = { t: (key) => key, draft, picking: null, initialTab: 'ai' }
  let nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, props))
  assert.equal(nodes.filter((node) => node.props.className === 'SN_settingsTab').length, 4)
  assert.equal(nodes.find((node) => node.props['data-settings-tab'] === 'folders').props.hidden, true)
  assert.equal(nodes.find((node) => node.props['data-settings-tab'] === 'ai').props.hidden, false)
  let groups = nodes.filter((node) => node.props.className === 'SN_emojiGroup')
  assert.deepEqual(groups.map((node) => node.props.hidden), [false, true])
  nodes.find((node) => node.props.role === 'tab' && node.props['aria-label'] === '乙').props.onClick()
  nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, props))
  groups = nodes.filter((node) => node.props.className === 'SN_emojiGroup')
  assert.deepEqual(groups.map((node) => node.props.hidden), [true, false])
  assert.equal(nodes.filter((node) => node.props.className === 'SN_emojiTab SN_emojiAdd').length, 1)
  nodes.find((node) => node.props.className === 'SN_settingsTab' && node.children.includes('settings.tab.config')).props.onClick()
  nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, props))
  assert.equal(nodes.find((node) => node.props['data-settings-tab'] === 'config').props.hidden, false)
  assert.equal(nodes.some((node) => node.type === runner.api.components.TrashSettings), true)
})

test('v0.16 管理与关于：共享设置页包含 GitHub 与作者信息', (t) => {
  const api = loadClient(t).mod.__test
  const nodes = captureNodes(api.components.SettingsDrawer({ t: (key) => key, draft: { emojis: [] }, initialTab: 'config' }))
  const page = nodes.find((node) => node.props['data-settings-tab'] === 'config')
  const about = captureNodes(page).find((node) => node.props.className === 'SN_drawerSection SN_about')
  const link = captureNodes(about).find((node) => node.type === 'a')
  assert.equal(link.props.href, PACKAGE_JSON.repository.url.replace(/^git\+|\.git$/g, ''))
  assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(api.dictionaries.zh['settings.tab.config'], '管理与关于')
  assert.deepEqual(link.children, ['GitHub'])
  assert.equal(api.dictionaries.zh['settings.author'], 'by ' + PACKAGE_JSON.author)
  assert.deepEqual(about.children.map((node) => node.type), ['a', 'p'])
  assert.match(CLIENT_SOURCE, /\.SN_configActions>select\{appearance:none;-webkit-appearance:none;background-image:none/)
})
