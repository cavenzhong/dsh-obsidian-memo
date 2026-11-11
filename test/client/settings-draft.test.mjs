/** client: settings-draft regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, flush, hookRunner } from '../../test-support/client.mjs'

test('设置 hook：实时设置刷新不覆盖正在编辑的草稿', (t) => {
  const runner = hookRunner(t), viewRef = { current: { settings: { vaultPath: '/old', emojis: [] } } }
  const options = {
    t: (key) => key, tRef: { current: (key) => key }, viewRef, updateView() {},
    request: async () => ({}), refreshNow: async () => {}, aliveRef: { current: true },
    panelRef: { current: null }, pushToast() {}, pushErrorToast() {}, onOpen() {},
  }
  let settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  settings.openSettings()
  settings.patchDraft({ vaultPath: '/my-draft' })
  viewRef.current = { settings: { vaultPath: '/external', emojis: [] } }
  settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  assert.equal(settings.settingsDraft.vaultPath, '/my-draft')
  settings.closeSettings()
  settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  settings.openSettings()
  settings = runner.render(runner.api.hooks.useSettingsDraft, options)
  assert.equal(settings.settingsDraft.vaultPath, '/external')
})

test('v0.16 设置草稿：切换仓库保留相对文件夹，保存使用打开时的配置版本', async (t) => {
  const runner = hookRunner(t), calls = []
  const settings = { vaultPath: '/old', notesDir: '/old/notes', projectDir: '/old/projects',
    archiveTargets: [{ id: 'a', path: '/old/archive' }], emojis: [{ id: 'a', emoji: '🙂' }], configFile: { path: '/config.json', revision: 'original' } }
  const options = { t: (key) => key, tRef: { current: (key) => key }, viewRef: { current: { settings } },
    updateView() {}, request: async (endpoint, payload) => { calls.push({ endpoint, payload }); return { settings: payload.settings } },
    refreshNow: async () => {}, aliveRef: { current: true }, panelRef: { current: null }, pushToast() {}, pushErrorToast() {}, onOpen() {} }
  let controls = runner.render(runner.api.hooks.useSettingsDraft, options)
  controls.openSettings(); controls = runner.render(runner.api.hooks.useSettingsDraft, options)
  controls.patchDraft({ vaultPath: '/new' }); controls = runner.render(runner.api.hooks.useSettingsDraft, options)
  assert.equal(controls.settingsDraft.notesDir, 'notes')
  assert.equal(controls.settingsDraft.projectDir, 'projects')
  assert.equal(controls.settingsDraft.archiveTargets[0].path, 'archive')
  controls.saveSettingsDraft(); await flush()
  assert.equal(calls[0].payload.expected, 'original')
})

test('v0.16 设置会话：关闭重开后旧选择结果与旧配置回调不能污染新草稿', async (t) => {
  const runner = hookRunner(t), picked = deferred(), updates = []
  const options = {
    t: (key) => key, tRef: { current: (key) => key }, viewRef: { current: { settings: { vaultPath: '/old', notesDir: '/old/notes', emojis: [] } } },
    updateView: (next) => updates.push(next), request: () => picked.promise, refreshNow: async () => {},
    aliveRef: { current: true }, panelRef: { current: null }, pushToast() {}, pushErrorToast() {}, onOpen() {},
  }
  const render = () => runner.render(runner.api.hooks.useSettingsDraft, options)
  let controls = render()
  controls.openSettings(); controls = render()
  const oldConfigCallback = controls.acceptConfigSettings
  const pending = controls.systemPick('notesDir')
  controls.closeSettings(); controls = render()
  options.viewRef.current.settings = { vaultPath: '/new', notesDir: '/new/notes', emojis: [] }
  controls.openSettings(); controls = render()
  picked.resolve({ path: '/old/picked' })
  assert.equal(await pending, null)
  oldConfigCallback({ vaultPath: '/stale', emojis: [] }, 'reload')
  controls = render()
  assert.equal(controls.settingsDraft.vaultPath, '/new')
  assert.equal(controls.settingsDraft.notesDir, '/new/notes')
  assert.equal(updates.length, 0)
})
