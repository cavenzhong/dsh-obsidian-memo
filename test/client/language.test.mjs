/** Language preference and translated reader/diagnostics. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CLIENT_SOURCE, captureNodes, flush, hookRunner, loadClient } from '../../test-support/client.mjs'
import { formatDiagnostic } from '../../src/client/i18n/diagnostics.js'
import { en, zh } from '../../src/client/i18n/index.js'

const preferenceKey = 'dsh-sticky-notes.uiLanguage.v1'
const translate = (dict) => (key) => dict[key] ?? key
const isTab = (id) => (node) => node.props['data-settings-tab'] === id
const byClass = (name) => (node) => node.props.className === name

function stubDocument(t) {
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  t.after(() => { delete globalThis.document })
}

test('界面语言：默认跟随 Harness，可从设置即时覆盖、恢复跟随及跨面板重新挂载', async (t) => {
  const runner = hookRunner(t)
  stubDocument(t)
  const requests = []
  const listeners = new Set()
  let active = 'zh'
  let dicts
  runner.apply({
    connection: { rpc: { call: async (_channel, method) => { requests.push(method); return { ok: true, value: { settings: {} } } } } },
    locale: {
      register(_ns, value) { dicts = value },
      bind: () => (key) => dicts[active][key] ?? key,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    },
    slots: { inject() {} },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') t.after(dispose) },
  })
  const { StickyNotesPanel, SettingsDrawer } = runner.api.components
  const render = () => runner.render(StickyNotesPanel, {})
  const open = (panel, label) => captureNodes(panel).find((node) => node.props['aria-label'] === label).props.onClick()
  const drawer = (panel) => captureNodes(panel).find((node) => node.type === SettingsDrawer)
  const setHostLanguage = (value) => { active = value; for (const listener of listeners) listener() }

  runner.storage.setItem(preferenceKey, 'unsupported')
  const main = render()
  assert.equal(main.props.lang, 'zh-CN')
  assert.equal(listeners.size, 1)
  await flush()
  open(render(), '设置')
  const initialSettings = drawer(render()).props
  assert.equal(initialSettings.language, 'system')
  assert.equal(initialSettings.t('settings.languageSystem'), '跟随 Harness')
  initialSettings.onPatch({ notesDir: '尚未保存的路径' })
  const draft = drawer(render()).props.draft

  // Execute the real <select> handler from the SettingsDrawer tree.
  const settingsView = loadClient(t).mod.__test.components.SettingsDrawer({ ...drawer(render()).props, initialTab: 'config' })
  const management = captureNodes(settingsView).find(isTab('config'))
  assert.equal(management.props.hidden, false)
  const languageSection = management.children[0]
  const select = captureNodes(languageSection.type(languageSection.props)).find((node) => node.type === 'select')
  assert.deepEqual(select.children.map((option) => option.props.value), ['system', 'zh', 'en'])
  select.props.onChange({ target: { value: 'en' } })
  const englishPanel = render()
  assert.equal(englishPanel.props.lang, 'en')
  assert.ok(captureNodes(englishPanel).some((node) => node.props['aria-label'] === 'Settings'))
  const english = drawer(englishPanel).props
  assert.equal(english.draft, draft, '切换不应重置设置草稿')
  assert.equal(english.t('panel.count', { count: 2 }), '2 notes')
  assert.equal(runner.storage.getItem(preferenceKey), 'en')
  assert.ok(!requests.includes('saveSettings'))

  english.onCancel()
  runner.unmount()
  assert.equal(listeners.size, 0)
  assert.equal(render().props.lang, 'en', '关闭、取消及重新挂载后仍保留选择')
  await flush()
  open(render(), 'Settings')
  drawer(render()).props.onLanguageChange('zh')
  setHostLanguage('en')
  assert.equal(render().props.lang, 'zh-CN', '手动选择不被宿主语言覆盖')
  drawer(render()).props.onLanguageChange('system')
  assert.equal(render().props.lang, 'en')
  setHostLanguage('zh')
  assert.equal(render().props.lang, 'zh-CN')
  assert.equal(runner.storage.getItem(preferenceKey), 'system')
})

test('语言偏好：localStorage 不可用时仍可在当前面板切换', async (t) => {
  const runner = hookRunner(t)
  stubDocument(t)
  const { StickyNotesPanel, SettingsDrawer } = runner.api.components
  const render = () => runner.render(StickyNotesPanel, { t: translate(zh) })
  runner.storage.setItem = () => { throw new Error('no storage') }
  runner.connect(async () => ({ ok: true, value: { settings: {} } }))
  render()
  await flush()
  captureNodes(render()).find((node) => node.props.title === '设置').props.onClick()
  captureNodes(render()).find((node) => node.type === SettingsDrawer).props.onLanguageChange('en')
  assert.equal(render().props.lang, 'en')
})


test('阅读器任务、图片占位和已知 Host 错误使用当前语言', (t) => {
  const { NoteBlock, NoteImage, ToastStack } = loadClient(t).mod.__test.components
  const english = translate(en)
  const task = (checked) => captureNodes(NoteBlock({ t: english, block: { kind: 'li', checked, text: '保留正文' } }))
  assert.equal(task(false).find(byClass('SN_taskCheck')).props['aria-label'], 'Mark complete')
  assert.equal(task(true).find(byClass('SN_taskCheck')).props['aria-label'], 'Mark incomplete')
  assert.equal(task(true).find(byClass('SN_taskText')).children[0], '保留正文')
  assert.equal(NoteImage({ t: english, source: 'a.png' }).children[0], 'Loading image…')
  const error = '读不到默认工作空间：/仓库/便签（ENOENT）'
  const toast = (t) => captureNodes(ToastStack({ t, toasts: [{ id: 1, kind: 'error', text: error }] })).find(byClass('SN_toastText')).children[0]
  assert.equal(toast(english), 'Could not read the default workspace: /仓库/便签 (ENOENT)')
  assert.equal(toast(translate(zh)), error)
  assert.equal(formatDiagnostic(english, '配置未加载：配置文件必须是 JSON 对象'), 'Could not load the configuration: The configuration file must contain a JSON object')
  assert.equal(formatDiagnostic(english, 'error.offline'), 'Connection is not ready')
  assert.equal(formatDiagnostic(english, 'customRoots is not defined'), 'customRoots is not defined')
})

test('中英文词条的键和插值参数一致，静态文案键可解析', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const key of Object.keys(en)) assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key)
  const keys = [...new Set([...CLIENT_SOURCE.matchAll(/\b(?:t|tRef\.current)\(['"]([\w.-]+)['"]\s*[,)]/g)].map((match) => match[1]))]
  for (const key of keys) assert.ok(Object.hasOwn(en, key), `Missing locale key: ${key}`)
})
