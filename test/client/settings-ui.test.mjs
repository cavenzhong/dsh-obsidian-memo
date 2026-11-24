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
  assert.equal(nodes.filter((node) => node.props.className === 'SN_settingsTab').length, 5)
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

test('管理与关于：保留 GitHub 链接和署名，随界面语言显示 Star 邀请', (t) => {
  const api = loadClient(t).mod.__test
  assert.equal(api.dictionaries.zh['settings.tab.config'], '管理与关于')
  for (const [locale, invitation] of [
    ['zh', '如果这个插件帮到了你，欢迎在 GitHub 点个 Star。'],
    ['en', 'If this plugin helped you, feel free to give it a star on GitHub.'],
  ]) {
    const translate = (key) => api.dictionaries[locale][key] ?? key
    const nodes = captureNodes(api.components.SettingsDrawer({ t: translate, draft: { emojis: [] }, initialTab: 'config' }))
    const page = nodes.find((node) => node.props['data-settings-tab'] === 'config')
    const about = captureNodes(page).find((node) => node.props.className === 'SN_drawerSection SN_about')
    const [link, author, hint] = about.children
    assert.equal(link.type, 'a')
    assert.equal(link.props.href, PACKAGE_JSON.repository.url.replace(/^git\+|\.git$/g, ''))
    assert.equal(link.props.target, '_blank')
    assert.equal(link.props.rel, 'noopener noreferrer')
    assert.deepEqual(link.children, ['GitHub'])
    assert.deepEqual(author.children, ['by ' + PACKAGE_JSON.author])
    assert.equal(hint.props.className, 'SN_aboutHint')
    assert.deepEqual(hint.children, [invitation])
  }
  assert.match(CLIENT_SOURCE, /\.SN_configActions>select\{appearance:none;-webkit-appearance:none;background-image:none/)
})

test('DSH 桌面端：设置抽屉与遮罩声明 no-drag 排除', (t) => {
  const api = loadClient(t).mod.__test
  const draft = { vaultPath: '/vault', notesDir: '/vault/notes', emojis: [] }
  const drawer = captureNodes(api.components.SettingsDrawer({ t: (key) => key, draft }))
  const aside = drawer.find((node) => node.type === 'aside')
  assert.equal(aside.props.className, 'SN_drawer')
  assert.equal(aside.props['data-window-drag-exclude'], '', '设置抽屉盖住顶栏拖动行，需要显式 no-drag')
  assert.equal(drawer.find((node) => node.props.className === 'SN_scrim').props['data-window-drag-exclude'], '')
  assert.equal(aside.props['aria-modal'], 'true')
})

// 0.16.8：便签标题模式三卡与文件名模板
test('v0.16.8 设置：标签顺序为 文件夹/便签/AI/管理与关于', (t) => {
  const runner = hookRunner(t)
  const draft = { vaultPath: '/v', notesDir: '/v/n', emojis: [] }
  const nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, { t: (key) => key, draft, initialTab: 'notes' }))
  const tabs = nodes.filter((node) => node.props.className === 'SN_settingsTab')
  assert.deepEqual(tabs.map((node) => node.children[0]), [
    'settings.tab.folders', 'settings.tab.notes', 'settings.tab.project', 'settings.tab.ai', 'settings.tab.config',
  ])
  assert.equal(tabs.some((node) => node.children[0] === 'settings.tab.images'), false, '旧「图片」标签应移除')
  const page = nodes.find((node) => node.props['data-settings-tab'] === 'notes')
  assert.ok(page, '「便签」页应存在')
  assert.equal(page.props.hidden, false)
  assert.equal(nodes.some((node) => node.props['data-settings-tab'] === 'images'), false)
})

test('v0.17 设置：项目 AI 引擎放在「AI」页独立成块，模型列表来自 DSH 目录', (t) => {
  const runner = hookRunner(t)
  const draft = {
    vaultPath: '/v', notesDir: '/v/n', emojis: [],
    projectModel: { provider: 'deepseek-account', model: 'deepseek-flash' },
    projectAi: { preset: 'high' },
  }
  const nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, { t: (key) => key, draft, initialTab: 'ai' }))
  assert.equal(nodes.find((node) => node.props['data-settings-tab'] === 'ai').props.hidden, false)
  const projectAi = nodes.find((node) => node.props['data-settings-tab'] === 'ai-project')
  assert.ok(projectAi, 'AI 页应有独立的项目 AI 区块')
  const select = captureNodes(projectAi).find((node) => node.type === 'select' && node.props['aria-label'] === 'settings.projectModel')
  assert.ok(select, '项目 AI 引擎下拉应在 AI 页')
  // 目录还没加载时，已保存但不在列表里的模型仍要显示为可选项，不能静默空白。
  const optionValues = captureNodes(select).filter((node) => node.type === 'option').map((node) => node.props.value)
  assert.deepEqual(optionValues, ['', 'deepseek-account\u0000deepseek-flash'])
  const projectPage = nodes.find((node) => node.props['data-settings-tab'] === 'project')
  assert.equal(captureNodes(projectPage).some((node) => node.type === 'select'), false, '「项目」页不再放模型下拉')
  assert.equal(captureNodes(projectPage).some((node) => node.props.className === 'SN_aiBudgetRow'), false)
})

test('v0.16.8 设置：三张 role=radio 大卡、条件提示、方向键与禁用态', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const TitleModeSettings = api.components.TitleModeSettings
  const patches = []
  const base = {
    t: (key, params) => (params && params.name ? key + ':' + params.name : key),
    disabled: false,
    onChangeMode: (titleMode) => patches.push({ titleMode }),
    onChangePattern: (fileNamePattern) => patches.push({ fileNamePattern }),
  }
  let nodes = captureNodes(TitleModeSettings({ ...base, mode: 'filename', pattern: '{date}-{time}' }))
  assert.ok(nodes.some((node) => node.props.role === 'radiogroup'))
  let cards = nodes.filter((node) => node.props.role === 'radio')
  assert.equal(cards.length, 3)
  assert.deepEqual(cards.map((node) => node.props['data-mode']), ['filename', 'firstLine', 'heading'])
  assert.deepEqual(cards.map((node) => node.props['aria-checked']), [true, false, false])
  assert.deepEqual(cards.map((node) => node.props.tabIndex), [0, -1, -1])
  assert.ok(nodes.some((node) => node.props.className === 'SN_titleModeFilenameHint'), '文件名模式要有小字提示')
  assert.equal(nodes.some((node) => node.props.className === 'SN_titleModeFile'), false, '文件名模式不显示模板')
  for (const card of cards) {
    const art = captureNodes(card).find((node) => node.props.className === 'SN_titleModeArt')
    assert.ok(art, '每张卡都要有演示插画')
    const icon = captureNodes(api.components.TitleModeIcon({ mode: card.props['data-mode'] }))
    assert.ok(icon.some((node) => node.type === 'svg'))
  }

  cards[1].props.onClick()
  assert.deepEqual(patches.at(-1), { titleMode: 'firstLine' })
  cards[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: { parentElement: null } })
  assert.deepEqual(patches.at(-1), { titleMode: 'firstLine' })
  cards[0].props.onKeyDown({ key: 'Escape', preventDefault() {}, currentTarget: { parentElement: null } })
  assert.equal(patches.length, 2, '非方向键不应切换')

  // 切到 heading 后出现模板输入、4 个 token、预览；点击 token 插到末尾。
  nodes = captureNodes(TitleModeSettings({ ...base, mode: 'heading', pattern: '{date}-{time}' }))
  const file = nodes.find((node) => node.props.className === 'SN_titleModeFile')
  assert.ok(file)
  const input = captureNodes(file).find((node) => node.type === 'input' && node.props.maxLength === 120)
  assert.ok(input, '模板输入应限制 120 字符')
  const tokens = captureNodes(file).filter((node) => node.props.className === 'SN_titleModeToken')
  assert.deepEqual(tokens.map((node) => node.children[0]), ['{title}', '{date}', '{time}', '{timestamp}'])
  assert.ok(captureNodes(file).some((node) => node.props.className === 'SN_titleModePreview'))
  tokens[1].props.onClick()
  assert.equal(patches.at(-1).fileNamePattern, '{date}-{time}{date}')

  // 保存中：卡片和 token 都禁用，点击不触发。
  const before = patches.length
  nodes = captureNodes(TitleModeSettings({ ...base, disabled: true, mode: 'heading', pattern: '{date}-{time}' }))
  cards = nodes.filter((node) => node.props.role === 'radio')
  assert.equal(cards.every((node) => node.props.disabled === true), true)
  cards[2].props.onClick()
  const tokensDisabled = captureNodes(nodes.find((node) => node.props.className === 'SN_titleModeFile'))
    .filter((node) => node.props.className === 'SN_titleModeToken')
  assert.equal(tokensDisabled.every((node) => node.props.disabled === true), true)
  assert.equal(patches.length, before)

  // 抽屉里「便签」页应包含该组件。
  const drawerNodes = captureNodes(runnerRenderDrawer(t))
  const page = drawerNodes.find((node) => node.props['data-settings-tab'] === 'notes')
  assert.equal(page.props.className, 'SN_settingsPage', '便签各设置模块需使用纵向间距布局')
  assert.ok(captureNodes(page).some((node) => typeof node.type === 'function' && node.type.name === 'TitleModeSettings'))
})

function runnerRenderDrawer(t) {
  const runner = hookRunner(t)
  return runner.render(runner.api.components.SettingsDrawer, {
    t: (key) => key, draft: { vaultPath: '/v', notesDir: '/v/n', emojis: [] }, initialTab: 'notes',
  })
}

test('v0.18.6 设置：发送到 DeepSeek 在便签页、便签标题之后，而不是 AI 页', (t) => {
  const runner = hookRunner(t)
  const draft = {
    vaultPath: '/v', notesDir: '/v/n', emojis: [],
    deepseekSend: { skipMenu: false, workspaceId: '', workspacePath: '', workspaceTitle: '', format: 'text' },
  }
  const nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, {
    t: (key) => key, draft, initialTab: 'notes', request: async () => ({ providers: [] }),
    onPatch() {}, onPick: async () => null, onSave() {}, onCancel() {}, onAddEmoji() {}, onRemoveEmoji() {}, onPatchEmoji() {},
  }))
  const notes = nodes.find((node) => node.props['data-settings-tab'] === 'notes')
  const ai = nodes.find((node) => node.props['data-settings-tab'] === 'ai')
  const notesNodes = captureNodes(notes)
  const deepseek = notesNodes.find((node) => node.type === runner.api.components.DeepSeekSendSettings)
  assert.ok(deepseek, '便签页应有发送到 DeepSeek 设置块')
  const titleIndex = notesNodes.findIndex((node) => node.type === runner.api.components.TitleModeSettings)
  const deepseekIndex = notesNodes.findIndex((node) => node.type === runner.api.components.DeepSeekSendSettings)
  assert.ok(titleIndex >= 0 && deepseekIndex > titleIndex, '发送设置应排在便签标题之后')
  assert.equal(captureNodes(ai).some((node) => node.type === runner.api.components.DeepSeekSendSettings), false, 'AI 页不应再出现发送设置')
})

test('文件夹设置保留默认工作空间目录，不重复提供顶栏子文件夹开关', (t) => {
  const runner = hookRunner(t)
  const nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, {
    t: key => key, initialTab: 'folders', draft: { emojis: [], notesDir: '/vault/notes', includeSubfolders: false },
  }))
  const workspace = nodes.find(node => node.props.field === 'notesDir')
  assert.equal(workspace.props.value, '/vault/notes')
  assert.equal(nodes.some(node => node.children.includes('settings.includeSubfolders')), false)
})

test('操作引擎在仓库上方；默认 CLI，明确选择直接移动才显示双链风险', (t) => {
  const runner = hookRunner(t)
  const render = (engine, language, saving = false) => {
    const api = runner.api
    const messages = api.dictionaries[language]
    const patches = []
    const drawer = runner.render(api.components.SettingsDrawer, {
      t: key => messages[key] ?? key, draft: { operationEngine: engine, emojis: [] }, initialTab: 'folders',
      saving, onPatch: patch => patches.push(patch),
    })
    const folders = captureNodes(drawer).find(node => node.props['data-settings-tab'] === 'folders')
    const engineIndex = folders.children.findIndex(node => node?.props?.onPatch && Object.hasOwn(node.props, 'engine'))
    const engineNode = folders.children[engineIndex]
    assert.equal(folders.children[engineIndex + 1].props.field, 'vaultPath')
    const nodes = captureNodes(engineNode.type(engineNode.props))
    return { buttons: nodes.filter(node => node.type === 'button'), warning: nodes.find(node => node.props.role === 'status'), patches }
  }
  const cli = render(undefined, 'zh')
  assert.deepEqual(cli.buttons.map(button => button.props['aria-pressed']), [true, false])
  assert.equal(cli.warning, undefined)
  cli.buttons[1].props.onClick()
  assert.deepEqual(cli.patches, [{ operationEngine: 'direct' }])
  const direct = render('direct', 'en')
  assert.deepEqual(direct.buttons.map(button => button.props['aria-pressed']), [false, true])
  assert.deepEqual(direct.warning.children[0].children, ['Internal links may break'])
  direct.buttons[0].props.onClick()
  assert.deepEqual(direct.patches, [{ operationEngine: 'obsidian-cli' }])
  assert.ok(render('direct', 'zh', true).buttons.every(button => button.props.disabled))
})
