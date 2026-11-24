import test from 'node:test'
import assert from 'node:assert/strict'
import { captureNodes, deferred, flush, hookRunner } from '../../test-support/client.mjs'

function fieldRunner(t, props = {}, initialTab = 'folders') {
  const runner = hookRunner(t)
  const drawer = captureNodes(runner.render(runner.api.components.SettingsDrawer, {
    t: key => key, draft: { vaultPath: '', emojis: [] }, initialTab, firstSetup: true,
  }))
  const field = drawer.find(node => node.props.field === 'vaultPath')
  runner.unmount()
  const render = patch => captureNodes(runner.render(field.type, { ...field.props, ...props, ...patch }))
  const pathField = nodes => nodes.find(node => node.props.field === 'vaultPath')
  const badge = nodes => pathField(nodes).props.badge
  const button = (nodes, key) => nodes.find(node => node.type === 'button' && node.children.includes(`settings.${key}`))
  const renderPathField = nodes => {
    const node = pathField(nodes)
    return captureNodes(node.type(node.props))
  }
  return { drawer, render, renderPathField, badge, button, unmount: runner.unmount }
}

const cliRequest = path => ({ name: 'checkVault', payload: { path, verifyCli: true, onlyRunning: true } })
const status = badge => badge?.children.at(-1)
const setupSteps = nodes => nodes.filter(node => node.type === 'li').map(node => node.children[0])

test('CLI 首次设置：新建库前列出开启内部链接更新的步骤', async (t) => {
  const calls = []
  const { drawer, render, button, renderPathField } = fieldRunner(t, {
    request: async (name, payload) => { calls.push({ name, payload }); return { opened: true } },
  })
  assert.ok(drawer.some(node => node.children.includes('settings.vaultSetupTitle')))
  const initial = render({ firstSetup: true, value: '' })
  assert.ok(initial.some(node => node.props.href === 'https://obsidian.md/download'))
  assert.ok(initial.some(node => node.props.href === 'https://help.obsidian.md/cli'))
  assert.equal(button(renderPathField(initial), 'vaultRecheck').props.disabled, true)
  const expectedSteps = ['settings.vaultHandoff.new', 'settings.vaultHandoff.enableLinks', 'settings.vaultHandoff.returnNew']
  assert.deepEqual(setupSteps(initial), expectedSteps)
  assert.deepEqual(calls, [], 'no check without an address')
  await button(initial, 'vaultCreate').props.onClick()
  assert.deepEqual(calls, [{ name: 'openVaultManager', payload: { mode: 'new' } }])
  assert.deepEqual(setupSteps(render({ firstSetup: true, value: '' })), expectedSteps)
})

test('已有仓库：打开设置立即检查（即使从其他分类进入）；重新检查紧邻浏览的右侧', async (t) => {
  const calls = [], reply = deferred()
  const { render, badge, button, renderPathField, unmount } = fieldRunner(t, { picking: null, request(name, payload) {
    calls.push({ name, payload })
    return calls.length === 1 ? reply.promise : Promise.resolve({ status: 'cli-not-running' })
  } }, 'ai')
  const options = { value: '/vault' }
  const initial = render(options)
  assert.deepEqual(calls, [cliRequest('/vault')])
  assert.equal(status(badge(initial)), 'settings.vaultStatus.checking')
  assert.equal(button(renderPathField(initial), 'vaultRecheck').props.disabled, true)
  reply.resolve({ status: 'ready' })
  await flush()
  const ready = render(options)
  assert.equal(badge(ready).props['data-tone'], 'ready')
  assert.equal(button(ready, 'vaultRecheck'), undefined)
  const buttons = renderPathField(ready).find(node => node.props.className === 'SN_pathActions').children
  assert.deepEqual(buttons.map(node => node.children[0]), ['settings.pick', 'settings.vaultRecheck'])
  assert.equal(buttons[1].props.disabled, false)
  await buttons[1].props.onClick()
  assert.deepEqual(calls, [cliRequest('/vault'), cliRequest('/vault')])
  const stopped = render(options)
  assert.equal(status(badge(stopped)), 'settings.vaultStatus.cli-not-running')
  assert.equal(badge(stopped).props['data-tone'], 'warning')
  assert.ok(stopped.some(node => node.children.includes('settings.vaultHint.cli-not-running')))
  unmount()
  render(options)
  assert.deepEqual(calls, [cliRequest('/vault'), cliRequest('/vault'), cliRequest('/vault')])
})

test('系统选择新仓库自动检查；旧请求结果不能覆盖新路径', async (t) => {
  const calls = [], a = deferred()
  const { render, badge } = fieldRunner(t, { firstSetup: false, request(name, payload) {
    calls.push({ name, payload })
    if (payload.path === '/A') return a.promise
    return Promise.resolve({ status: 'ready', vaultPath: '/ActualVault', isSubfolder: true })
  } })
  render({ value: '/A' })
  assert.equal(status(badge(render({ value: '/B' }))), 'settings.vaultStatus.checking')
  assert.deepEqual(calls, [cliRequest('/A'), cliRequest('/B')])
  a.resolve({ status: 'overlap', paths: ['/A', '/A/nested'] })
  await flush()
  const detected = render({ value: '/B' })
  assert.equal(badge(detected).props['data-tone'], 'ready')
  assert.ok(detected.some(node => node.type === 'code' && node.children.includes('/ActualVault')))
  assert.deepEqual(calls, [cliRequest('/A'), cliRequest('/B')])
})

test('手输地址短暂停顿后自动检查，只提交最后的值；清空不探测', async (t) => {
  const calls = [], checking = deferred()
  let value = ''
  const { render, renderPathField, badge } = fieldRunner(t, {
    onPatch: patch => { value = patch.vaultPath },
    request(name, payload) { calls.push({ name, payload }); checking.resolve(); return Promise.resolve({ status: 'invalid' }) },
  })
  const edit = text => {
    const input = renderPathField(render({ value })).find(node => node.type === 'input')
    input.props.onChange({ target: { value: text } })
    return render({ value })
  }
  edit('/fi')
  assert.equal(status(badge(edit('/final'))), 'settings.vaultStatus.checking')
  assert.deepEqual(calls, [])
  await checking.promise
  await flush()
  assert.equal(status(badge(render({ value }))), 'settings.vaultStatus.invalid')
  assert.equal(badge(edit('')), null)
  assert.deepEqual(calls, [cliRequest('/final')])
})

test('只对合适的普通文件夹显示设为库；复检后以 CLI 和链接设置为准', async (t) => {
  const calls = []
  let detection = { status: 'plain', canRegister: true }
  const { render, badge, button, renderPathField } = fieldRunner(t, { firstSetup: false, request: async (name, payload) => {
    calls.push({ name, payload })
    return name === 'checkVault' ? detection : { opened: true }
  } })
  const options = { value: '/notes' }
  assert.equal(badge(render(options)).props['data-tone'], 'neutral')
  await flush()
  const plain = render(options)
  assert.equal(badge(plain).props['data-tone'], 'warning')
  assert.deepEqual(calls[0], cliRequest('/notes'))
  const expectedSteps = ['settings.vaultHandoff.register', 'settings.vaultHandoff.enableLinks', 'settings.vaultHandoff.returnRegister']
  assert.deepEqual(setupSteps(plain), expectedSteps)
  await button(plain, 'vaultRegister').props.onClick()
  assert.deepEqual(calls[1], { name: 'openVaultManager', payload: { mode: 'register', path: '/notes' } })
  const handedOff = render(options)
  assert.deepEqual(setupSteps(handedOff), expectedSteps)
  assert.equal(badge(handedOff).props['data-tone'], 'warning', '仅打开管理器不等于已设库')

  detection = { status: 'links-disabled', vaultPath: '/notes', isSubfolder: false }
  await button(renderPathField(handedOff), 'vaultRecheck').props.onClick()
  const registered = render(options)
  assert.equal(button(registered, 'vaultRegister'), undefined)
  assert.deepEqual(setupSteps(registered), [])
  assert.equal(status(badge(registered)), 'settings.vaultStatus.links-disabled')
  assert.ok(registered.some(node => node.children.includes('settings.vaultHint.links-disabled')))

  detection = { ...detection, status: 'ready' }
  await button(renderPathField(registered), 'vaultRecheck').props.onClick()
  const ready = render(options)
  assert.equal(badge(ready).props['data-tone'], 'ready')
  assert.equal(button(ready, 'vaultRegister'), undefined)
  assert.deepEqual(setupSteps(ready), [])
  assert.deepEqual(calls.slice(2), [cliRequest('/notes'), cliRequest('/notes')])
  assert.equal(button(render({ value: '/different' }), 'vaultRegister'), undefined)
})


test('文件夹管理使用普通目录字段：首次引导、手输和浏览都不调用 CLI 检测', async (t) => {
  const runner = hookRunner(t)
  const calls = [], picked = []
  let draft = { vaultPath: '', emojis: [], operationEngine: 'direct' }
  const render = () => {
    const nodes = captureNodes(runner.render(runner.api.components.SettingsDrawer, {
      t: key => key, draft, firstSetup: true, picking: null,
      request: (...args) => { calls.push(args); return Promise.resolve({ status: 'ready' }) },
      onPatch: patch => { draft = { ...draft, ...patch } },
      onPick: key => { picked.push(key); draft = { ...draft, [key]: '/plain/md' } },
    }))
    const field = nodes.find(node => node.props.field === 'vaultPath')
    return { nodes, field, children: captureNodes(field.type(field.props)) }
  }
  const initial = render()
  assert.ok(initial.nodes.some(node => node.children.includes('settings.vaultSetupDirect')))
  assert.ok(!initial.nodes.some(node => node.children.includes('settings.vaultSetupText')))
  assert.deepEqual(setupSteps(initial.children), [])
  assert.equal(initial.field.props.hint, 'settings.vaultFolderHint')
  initial.children.find(node => node.type === 'input').props.onChange({ target: { value: '/typed' } })
  const typed = render()
  assert.equal(typed.children.find(node => node.type === 'input').props.value, '/typed')
  const actions = typed.children.find(node => node.props.className === 'SN_pathActions').children.filter(Boolean)
  assert.deepEqual(actions.map(node => node.children[0]), ['settings.pick'])
  actions[0].props.onClick()
  const selected = render()
  assert.equal(selected.children.find(node => node.type === 'input').props.value, '/plain/md')
  assert.ok(!selected.children.some(node => node.props.role === 'status' || node.type === 'a'))
  assert.deepEqual(picked, ['vaultPath'])
  await flush()
  assert.deepEqual(calls, [])
})
