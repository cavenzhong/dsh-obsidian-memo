/** Client settings-config regression coverage. */
import test from 'node:test'
import { hookRunner, captureNodes, flush, loadClient, getTestApi, deferred } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('v0.16 顶栏子文件夹开关：保存携带当前配置版本，成功后继续刷新', async (t) => {
  const runner = hookRunner(t), calls = []
  const settings = { vaultPath: '/vault', notesDir: '/vault/notes', emojis: [], includeSubfolders: true, configFile: { revision: 'opened-config' } }
  runner.connect(async (channel, endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'saveSettings') return { ok: true, value: { settings: { ...payload.settings, configFile: { revision: 'saved-config' } } } }
    return { ok: true, value: { configured: true, revision: 'state-version', settings, notes: [], jobs: [] } }
  })
  const render = () => captureNodes(runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key }))
  render(); await flush()
  let nodes = render()
  const toggle = nodes.find((node) => node.props['aria-label'] === 'panel.subfolders')
  assert.equal(toggle.props.disabled, false)
  toggle.props.onClick(); await flush()
  const saved = calls.find((call) => call.endpoint === 'saveSettings')
  assert.equal(saved.payload.expected, 'opened-config')
  assert.equal(saved.payload.settings.includeSubfolders, false)
  assert.ok(calls.filter((call) => call.endpoint === 'state').length >= 2)
})

test('v0.16 归档设置：一个外框中仅有文件夹菜单与删除按钮', (t) => {
  const api = loadClient(t).mod.__test, removed = []
  const nodes = captureNodes(api.components.SettingsDrawer({ t: (key) => key, draft: { vaultPath: '/vault',
    emojis: [], archiveTargets: [{ id: 'archive', path: '/vault/archive', label: '重复名称' }] }, picking: null, onRemoveArchive: (index) => removed.push(index) }))
  const row = nodes.find((node) => node.props.className === 'SN_targetRow')
  assert.deepEqual(row.children.map((node) => node.type), [api.components.VaultFolderPicker, 'button'])
  assert.equal(captureNodes(row).some((node) => node.props.className === 'SN_targetLabel'), false)
  row.children[1].props.onClick()
  assert.deepEqual(removed, [0])
  assert.equal(nodes.find((node) => node.type === api.components.VaultFolderPicker && node.props.value === '').props.placeholder, 'settings.addArchive')
})

test('v0.16 Config：打开与加载为主操作，更多菜单含三个次要操作', async (t) => {
  const runner = hookRunner(t), calls = [], accepted = []
  const props = { t: (key) => key, config: { path: '/active/config.json' },
    request: async (endpoint, payload) => { calls.push({ endpoint, payload }); return endpoint === 'chooseConfigFile'
      ? { path: '/other/chosen.json' } : { settings: { configFile: { path: payload.path } } } },
    onSettings: (settings, action) => accepted.push(action) }
  const render = () => captureNodes(runner.render(runner.api.components.ConfigFileSettings, props))
  let nodes = render()
  const primary = nodes.filter((node) => node.type === 'button')
  assert.deepEqual(primary.map((node) => node.children[0]), ['settings.openConfig', 'settings.loadConfig'])
  assert.equal(nodes.some((node) => node.type === 'input'), false)
  const menu = () => nodes.find((node) => node.props['aria-label'] === 'settings.configActions')
  assert.deepEqual(menu().children.filter((node) => node.type === 'option').map((node) => node.props.value), ['', 'openFile', 'reload', 'relocate'])
  primary[0].props.onClick(); await flush()
  assert.deepEqual(calls[0], { endpoint: 'configFile', payload: { action: 'reveal', path: '' } })
  assert.equal(menu().props.className, primary[0].props.className)
  primary[1].props.onClick(); nodes = render()
  assert.deepEqual(calls[1], { endpoint: 'chooseConfigFile', payload: {} })
  assert.equal(nodes.some((node) => node.type === 'input'), false)
  assert.equal(nodes.find((node) => node.children.includes('settings.loadConfig')).props.disabled, true)
  await flush(); nodes = render()
  assert.deepEqual(calls[2], { endpoint: 'configFile', payload: { action: 'load', path: '/other/chosen.json' } })
  assert.deepEqual(accepted, ['reveal', 'load'])
  assert.equal(nodes.some((node) => node.type === 'input'), false)
  menu().props.onChange({ target: { value: 'relocate' } }); nodes = render()
  assert.ok(nodes.some((node) => node.children.includes('settings.configCopyHint')))
  nodes.find((node) => node.props['aria-label'] === 'settings.configPath').props.onChange({ target: { value: '/new/config.json' } })
  nodes = render(); nodes.find((node) => node.props.className === 'SN_primaryBtn').props.onClick()
  await flush(); nodes = render()
  assert.deepEqual(calls.at(-1), { endpoint: 'configFile', payload: { action: 'relocate', path: '/new/config.json' } })
  menu().props.onChange({ target: { value: 'openFile' } }); await flush(); nodes = render()
  assert.deepEqual(calls.at(-1), { endpoint: 'configFile', payload: { action: 'open', path: '' } })
  menu().props.onChange({ target: { value: 'reload' } }); await flush(); nodes = render()
  assert.equal(calls.at(-1).payload.action, 'reload')
  const pinned = captureNodes(runner.render(runner.api.components.ConfigFileSettings, { ...props, config: { ...props.config, pinned: true } }))
  assert.equal(pinned.find((node) => node.children.includes('settings.loadConfig')).props.disabled, true)
  assert.deepEqual(pinned.find((node) => node.props['aria-label'] === 'settings.configActions')
    .children.filter((node) => node && node.type === 'option').map((node) => node.props.value), ['', 'openFile', 'reload'])
})

test('v0.16 加载配置：取消选择不加载，失败保留设置并允许重试', async (t) => {
  const runner = hookRunner(t), calls = [], accepted = []
  let selected = null, fail = false
  const props = { t: (key) => key, config: { path: '/original/config.json' }, onSettings: (settings) => accepted.push(settings),
    request: async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      if (endpoint === 'chooseConfigFile') return { path: selected }
      if (fail) throw new Error('无效的 JSON')
      return { settings: { configFile: { path: selected } } }
    } }
  const render = () => captureNodes(runner.render(runner.api.components.ConfigFileSettings, props))
  const load = (nodes) => nodes.find((node) => node.type === 'button' && node.children.includes('settings.loadConfig'))
  load(render()).props.onClick(); await flush()
  assert.equal(calls.length, 1)
  assert.equal(accepted.length, 0)
  assert.equal(load(render()).props.disabled, undefined)
  selected = '/other/config.json'; fail = true
  load(render()).props.onClick(); await flush()
  assert.equal(accepted.length, 0)
  assert.ok(render().find((node) => node.props.role === 'alert').children.includes('无效的 JSON'))
  fail = false
  load(render()).props.onClick(); await flush()
  assert.equal(accepted.length, 1)
  assert.equal(render().some((node) => node.props.role === 'alert'), false)
})

test('只注册侧栏和便签面板，不注入 DSH 内置插件设置', (t) => {
  const { mod } = loadClient(t), injections = [], registrations = []
  mod.apply({ connection: {}, locale: { register() {}, bind: () => (key) => key },
    slots: { inject(name, fn) { injections.push(name); fn() }, register(options) { registrations.push(options.name); return () => {} } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') t.after(dispose); return dispose } })
  assert.deepEqual(injections, ['sidebar.panellist', 'main'])
  assert.deepEqual(registrations, injections)
})

test('面板内齿轮仍打开设置抽屉，顶栏无手动刷新按钮', async (t) => {
  const runner = hookRunner(t), calls = []
  const previous = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  runner.connect(async (channel, endpoint) => {
    calls.push(endpoint)
    return { ok: true, value: { configured: true, settings: { vaultPath: '/vault', emojis: [] }, revision: 'state-1' } }
  })
  const render = () => captureNodes(runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key }))
  render()
  await flush()
  const nodes = render()
  assert.deepEqual(calls, ['state'])
  assert.equal(nodes.some((node) => node.props['aria-label'] === 'panel.refresh'), false)
  nodes.find((node) => node.props['aria-label'] === 'panel.settings').props.onClick()
  assert.ok(render().some((node) => node.type === runner.api.components.SettingsDrawer))
})

test('client __test：PINNED_NOTE_KEY 与锁定面板便签路径的存取/清除', (t) => {
  const { mod, storage } = loadClient(t)
  const api = getTestApi(mod)
  assert.equal(api.PINNED_NOTE_KEY, 'dsh-sticky-notes.pinnedNote')
  assert.equal(api.readStoredPinnedNote(), '')

  api.storePinnedNote('/vault/notes/甲.md')
  assert.equal(storage.getItem(api.PINNED_NOTE_KEY), '/vault/notes/甲.md')
  assert.equal(api.readStoredPinnedNote(), '/vault/notes/甲.md')

  // 空路径/非字符串不写入
  api.storePinnedNote('')
  api.storePinnedNote(null)
  assert.equal(api.readStoredPinnedNote(), '/vault/notes/甲.md')

  api.clearStoredPinnedNote()
  assert.equal(storage.getItem(api.PINNED_NOTE_KEY), null)
  assert.equal(api.readStoredPinnedNote(), '')
})

test('v0.16 路径：仓库相对路径严格匹配边界，多个字段复用同一选择器', (t) => {
  const api = loadClient(t).mod.__test
  assert.equal(api.vaultRelative('/vault', '/vault/folder'), 'folder')
  assert.equal(api.vaultRelative('/vault', '/vault-other/folder'), '/vault-other/folder')
  assert.equal(api.vaultRelative('/vault/', '/vault'), '.')
  const patches = []
  const nodes = captureNodes(api.components.SettingsPathField({ t: (key) => key, label: '便签', field: 'notesDir',
    vaultPath: '/vault', value: '/vault/notes', picking: null, onPatch: (patch) => patches.push(patch) }))
  const shared = nodes.find((node) => node.type === api.components.VaultFolderPicker)
  assert.ok(shared)
  shared.props.onChange('新的文件夹')
  assert.deepEqual(patches, [{ notesDir: '新的文件夹' }])
})

test('v0.16 目录下拉：新建位于首项，系统选择随后，历史跨字段可选', async (t) => {
  const runner = hookRunner(t), calls = [], chosen = [], creation = deferred()
  const previous = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  const props = { t: (key) => key, label: '便签', value: '/vault/notes', vaultPath: '/vault', history: ['/vault/old'],
    onChange: (path) => chosen.push(path), onPick: async () => '/vault/picked',
    request: async (endpoint, payload) => { calls.push({ endpoint, payload }); return endpoint === 'listFolders' ? { folders: ['notes', 'old'] } : creation.promise } }
  const render = () => captureNodes(runner.render(runner.api.components.VaultFolderPicker, props))
  let nodes = render()
  nodes.find((node) => node.props.className === 'SN_folderTrigger').props.onClick()
  render(); await flush(); nodes = render()
  assert.equal(calls[0].endpoint, 'listFolders')
  const menu = nodes.filter((node) => node.props.className === 'SN_folderOption')
  assert.ok(menu[0].children.includes('settings.newFolder'))
  assert.ok(menu[1].children.includes('settings.browseFolder'))
  menu[0].props.onClick(); nodes = render()
  nodes.find((node) => node.props['aria-label'] === 'settings.folderName').props.onChange({ target: { value: 'new' } })
  nodes = render()
  assert.ok(nodes.some((node) => node.children.includes('settings.newFolderHint')))
  assert.ok(nodes.some((node) => node.type === 'code' && node.children.includes('settings.createAt: /vault/new')))
  nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
  nodes = render()
  assert.ok(nodes.find((node) => node.type === 'button' && node.props.type === 'submit').children.includes('settings.creatingFolder'))
  assert.equal(nodes.find((node) => node.props['aria-label'] === 'settings.folderName').props.disabled, true)
  creation.resolve({ path: '/vault/new' })
  await flush(); nodes = render()
  assert.deepEqual(calls[1], { endpoint: 'createFolder', payload: { vaultPath: '/vault', path: 'new' } })
  assert.deepEqual(chosen, ['/vault/new'])
  assert.equal(nodes.find((node) => node.props.className === 'SN_folderTrigger').props['aria-expanded'], false)
  assert.ok(nodes.find((node) => node.props.className === 'SN_fieldHint SN_folderCreated').children.includes('settings.folderCreated'))
})

test('v0.16 回收站：入口与确认均使用红色边框按钮，确认后才转移', async (t) => {
  const runner = hookRunner(t), calls = []
  const props = { t: (key) => key, request: async (endpoint, payload) => { calls.push({ endpoint, payload }); return { moved: 1 } } }
  const render = () => captureNodes(runner.render(runner.api.components.TrashSettings, props))
  let nodes = render()
  nodes.find((node) => node.props.className === 'SN_ghostBtn SN_dangerBtn').props.onClick()
  nodes = render()
  const danger = nodes.filter((node) => node.props.className === 'SN_ghostBtn SN_dangerBtn')
  assert.equal(danger.length, 2)
  assert.equal(calls.length, 0)
  danger[1].props.onClick(); await flush(); nodes = render()
  assert.deepEqual(calls, [{ endpoint: 'trash', payload: { action: 'empty', confirm: true } }])
  assert.equal(nodes.some((node) => node.props.className === 'SN_trashConfirm'), false)
})

test('v0.16 目录新建：切换仓库后忽略旧结果并恢复可操作状态', async (t) => {
  const runner = hookRunner(t), creation = deferred(), chosen = []
  const previous = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
  let props = { t: (key) => key, label: '便签', vaultPath: '/old', history: [], onChange: (path) => chosen.push(path),
    request: (endpoint) => endpoint === 'listFolders' ? Promise.resolve({ folders: [] }) : creation.promise }
  const render = () => captureNodes(runner.render(runner.api.components.VaultFolderPicker, props))
  let nodes = render()
  nodes.find((node) => node.props.className === 'SN_folderTrigger').props.onClick()
  render(); await flush(); nodes = render()
  nodes.find((node) => node.props.className === 'SN_folderOption').props.onClick(); nodes = render()
  nodes.find((node) => node.props['aria-label'] === 'settings.folderName').props.onChange({ target: { value: 'child' } })
  nodes = render(); nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
  props = { ...props, vaultPath: '/new' }; render()
  creation.resolve({ path: '/old/child' }); await flush(); nodes = render()
  assert.deepEqual(chosen, [])
  const trigger = nodes.find((node) => node.props.className === 'SN_folderTrigger')
  assert.equal(trigger.props['aria-expanded'], false)
  trigger.props.onClick(); render(); await flush(); nodes = render()
  assert.equal(nodes.find((node) => node.props.className === 'SN_folderOption').props.disabled, false)
})
