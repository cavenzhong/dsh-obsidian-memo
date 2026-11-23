/** 0.18.6 发送到 DeepSeek：共享浮层、设置块与面板直发/菜单流程。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { captureNodes, CLIENT_SOURCE, flush, hookRunner, loadClient } from '../../test-support/client.mjs'

const DEFAULT_WORKSPACE = {
  workspaceId: 'ws-default',
  path: '/Users/me/deepseek-harness/default-workspace',
  title: 'default-workspace',
  sessionIds: [],
}
const OTHER_WORKSPACE = {
  workspaceId: 'ws-other',
  path: '/Users/me/project',
  title: '我的项目',
  sessionIds: [],
}

function workspaceService(items = [DEFAULT_WORKSPACE, OTHER_WORKSPACE]) {
  return {
    list: {
      getSnapshot: () => ({ items, phase: 'ready', archivedSessionIds: [], pinnedSessionIds: [] }),
      subscribe: () => () => {},
    },
  }
}

test('SendMenu：默认工作区固定第一，格式可切换，选择工作区回调带完整对象', (t) => {
  const api = loadClient(t).mod.__test, calls = []
  const tree = api.components.SendMenu({
    t: (key) => key,
    menu: { note: { title: '便签标题' }, format: 'text' },
    workspaces: { items: [DEFAULT_WORKSPACE, OTHER_WORKSPACE], defaultId: 'ws-default', primaryId: 'ws-default', phase: 'ready' },
    defaultId: 'ws-default',
    sending: false,
    onChoose: (workspace) => calls.push(['choose', workspace.workspaceId]),
    onFormat: (format) => calls.push(['format', format]),
    onClose: () => calls.push(['close']),
  })
  const nodes = captureNodes(tree)
  const workspaceButtons = nodes.filter((node) => node.props.className === 'SN_sendWorkspace')
  assert.deepEqual(workspaceButtons.map((node) => node.props['data-primary']), ['true', 'false'])
  assert.match(workspaceButtons[0].children[0].children[0].children[0], /send\.defaultWorkspace/)
  const formats = nodes.filter((node) => node.props.className === 'SN_sendFormatBtn')
  assert.deepEqual(formats.map((node) => node.props['data-active']), ['true', 'false'])
  formats[1].props.onClick()
  workspaceButtons[1].props.onClick()
  assert.deepEqual(calls, [['format', 'document'], ['choose', 'ws-other']])
})

test('SelectionMenu：选中文字右键菜单提供复制与发送到 DeepSeek', (t) => {
  const api = loadClient(t).mod.__test, calls = []
  const tree = api.components.SelectionMenu({
    t: (key) => key,
    menu: { text: '选中的一段文字', x: 40, y: 60 },
    onCopy: (text) => calls.push(['copy', text]),
    onSend: (text) => calls.push(['send', text]),
    onClose: () => calls.push(['close']),
  })
  const nodes = captureNodes(tree)
  const items = nodes.filter((node) => node.props.role === 'menuitem')
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((node) => node.props.className), ['SN_contextMenuItem', 'SN_contextMenuItem SN_contextMenuSend'])
  items[0].props.onClick()
  items[1].props.onClick()
  assert.deepEqual(calls, [['copy', '选中的一段文字'], ['send', '选中的一段文字']])
})

test('readSelectedText：只返回面板内、与右键目标相交的选中文字', (t) => {
  const api = loadClient(t).mod.__test
  const panel = { contains: (node) => node === panelNode || node === field },
    panelNode = { nodeType: 1 },
    field = { nodeType: 1, value: 'abcdef', selectionStart: 1, selectionEnd: 4 }
  const fieldDoc = { activeElement: field, getSelection: () => null }
  assert.equal(api.readSelectedText(panel, field, fieldDoc), 'bcd')
  assert.equal(api.readSelectedText(panel, { nodeType: 1 }, fieldDoc), '')
  const range = {
    commonAncestorContainer: panelNode,
    intersectsNode: (node) => node === target,
  }
  const selection = { isCollapsed: false, rangeCount: 1, toString: () => 'hello', getRangeAt: () => range }
  const target = { nodeType: 1 }
  const doc = { activeElement: null, getSelection: () => selection }
  assert.equal(api.readSelectedText(panel, target, doc), 'hello')
  assert.equal(api.readSelectedText(panel, { nodeType: 1 }, doc), '')
  assert.equal(api.readSelectedText(panel, target, { activeElement: null, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }) }), '')
})

test('DeepSeekSendSettings：勾选直发后工作区与形式可选；未勾选时禁用并显示菜单提示', (t) => {
  const api = loadClient(t).mod.__test, patches = []
  const workspaces = { items: [DEFAULT_WORKSPACE, OTHER_WORKSPACE], defaultId: 'ws-default', primaryId: 'ws-default', phase: 'ready' }
  const render = (value) => captureNodes(api.components.DeepSeekSendSettings({
    t: (key) => key,
    value,
    workspaces,
    defaultId: 'ws-default',
    primaryId: 'ws-default',
    disabled: false,
    onChange: (next) => patches.push(next),
  }))
  let nodes = render({ skipMenu: false, workspaceId: '', format: 'text' })
  const checkbox = nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(checkbox.props.checked, false)
  const selects = nodes.filter((node) => node.type === 'select')
  assert.deepEqual(selects.map((node) => node.props.disabled), [true, true])
  checkbox.props.onChange({ target: { checked: true } })
  assert.equal(patches.at(-1).skipMenu, true)
  assert.equal(patches.at(-1).workspaceId, 'ws-default', '勾选直发时自动补默认工作区')

  nodes = render({ skipMenu: true, workspaceId: 'ws-other', format: 'document' })
  const enabled = nodes.filter((node) => node.type === 'select')
  assert.deepEqual(enabled.map((node) => node.props.disabled), [false, false])
  assert.equal(enabled[0].props.value, 'ws-other')
  assert.equal(enabled[1].props.value, 'document')
  const options = captureNodes(nodes.find((node) => node.props['aria-label'] === 'settings.deepseekWorkspace'))
    .filter((node) => node.type === 'option').map((node) => node.props.value)
  assert.deepEqual(options.slice(0, 2), ['ws-default', 'ws-other'], '默认工作区仍固定第一')
})

function mountPanel(t, settings, extra = {}) {
  const runner = hookRunner(t)
  const sessionCalls = [], openCalls = [], draftCalls = [], initCalls = [], attachmentIds = []
  attachmentIds.push(...(extra.initialAttachmentIds || []))
  const note = {
    path: '/Users/me/notes/一条 带空格 的便签.md',
    name: '一条 带空格 的便签',
    title: '便签标题',
    excerpt: '',
    comments: [],
    images: [],
    created: Date.now(),
  }
  const full = { ...note, body: '第一行标题\n\n正文第一段', blocks: [{ kind: 'p', text: '正文第一段' }] }
  const conversation = {
    input: {
      requestDraftInitialization: (binding, options) => { initCalls.push({ binding, options }); return 'applied' },
      for: () => ({
        state: { getSnapshot: () => ({ attachmentIds: [...attachmentIds] }) },
        // DSH 的公开适配器 removeAttachment 返回 void；状态通过 snapshot 更新。
        removeAttachment: (id) => { const index = attachmentIds.indexOf(id); if (index >= 0) attachmentIds.splice(index, 1) },
        addAttachments: (ids) => { attachmentIds.push(...ids); return true },
      }),
    },
    createDrafts: (sessionId, files, uploadImages) => { draftCalls.push({ sessionId, files, uploadImages }); return [{ id: 'draft-1' }] },
    releaseDraftAttachment: (id) => { const index = attachmentIds.indexOf(id); if (index >= 0) attachmentIds.splice(index, 1) },
    releaseDraftAttachments: (drafts) => { for (const draft of drafts) { const index = attachmentIds.indexOf(draft.id); if (index >= 0) attachmentIds.splice(index, 1) } },
  }
  const sessions = { binding: (sessionId) => ({ sessionId, ctx: { sessionId } }) }
  const uiWorkspace = {
    startSession: (workspaceId, options) => sessionCalls.push([workspaceId, options]),
    openWorkspace: async (workspaceId, beforeOpen) => { openCalls.push(workspaceId); beforeOpen('session-1') },
  }
  runner.connect(async (channel, endpoint) => {
    if (endpoint === 'state') {
      return { ok: true, value: { configured: true, notes: [note], revision: '1', jobs: [], settings: Object.assign({ emojis: [], archiveMode: 'local', titleMode: 'firstLine' }, settings) } }
    }
    if (endpoint === 'note') return { ok: true, value: full }
    if (endpoint === 'noteFile') return { ok: true, value: extra.noteFile || { name: '一条 带空格 的便签.md', text: 'raw markdown' } }
    assert.fail('Unexpected endpoint ' + endpoint)
  }, Object.assign({ workspaces: workspaceService(), uiWorkspace, sessions, conversation }, extra.services))
  const render = () => captureNodes(runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key }))
  render()
  return { runner, render, note, sessionCalls, openCalls, draftCalls, initCalls, attachmentIds, api: runner.api }
}

test('面板：点击卡片 DeepSeek 打开共享菜单，选默认工作区后把标题+正文填进新对话', async (t) => {
  const { render, note, sessionCalls, api } = mountPanel(t, { deepseekSend: { skipMenu: false, format: 'text' } })
  await flush()
  let nodes = render()
  const card = nodes.find((node) => node.type === api.components.NoteCard)
  card.props.actions.current.onDeepSeek(note, {})
  nodes = render()
  const menu = nodes.find((node) => node.type === api.components.SendMenu)
  assert.ok(menu, '应渲染共享发送菜单')
  menu.props.onChoose(DEFAULT_WORKSPACE)
  await flush()
  assert.equal(sessionCalls.length, 1)
  assert.equal(sessionCalls[0][0], 'ws-default')
  assert.deepEqual(sessionCalls[0][1], { prompt: '第一行标题\n\n正文第一段', whenDraftExists: 'replace' })
})

test('面板：设置里勾选直发后，点击卡片直接发送到指定工作区，不发打开菜单', async (t) => {
  const { render, note, sessionCalls, api } = mountPanel(t, {
    deepseekSend: { skipMenu: true, workspaceId: 'ws-other', format: 'text' },
  })
  await flush()
  let nodes = render()
  nodes.find((node) => node.type === api.components.NoteCard).props.actions.current.onDeepSeek(note, {})
  await flush()
  nodes = render()
  assert.equal(nodes.some((node) => node.type === api.components.SendMenu), false)
  assert.equal(sessionCalls.length, 1)
  assert.equal(sessionCalls[0][0], 'ws-other')
  assert.deepEqual(sessionCalls[0][1], { prompt: '第一行标题\n\n正文第一段', whenDraftExists: 'replace' })
})

test('面板：MD 附件上传前移除评论 callout，保留 frontmatter、代码示例与普通引用', async (t) => {
  const { render, note, sessionCalls, openCalls, draftCalls, initCalls, attachmentIds, api } = mountPanel(t, {
    deepseekSend: { skipMenu: true, workspaceId: 'ws-other', format: 'document' },
  }, { noteFile: {
    name: '一条便签.md',
    text: '\uFEFF---\r\ntitle: sample\r\n---\r\n# 第一行标题\r\n\r\n正文内容\r\n\r\n> [!note] 🧭 落地\r\n> 私有评论\r\n\r\n~~~md\r\n> [!warning] 代码示例\r\n~~~\r\n\r\n> 普通引用',
  }, initialAttachmentIds: ['stale-draft'] })
  await flush()
  const nodes = render()
  nodes.find((node) => node.type === api.components.NoteCard).props.actions.current.onDeepSeek(note, {})
  await flush()
  assert.equal(sessionCalls.length, 0, '附件模式不走 startSession')
  assert.deepEqual(openCalls, ['ws-other'])
  assert.equal(initCalls.length, 1)
  assert.equal(initCalls[0].options.prompt, '第一行标题')
  assert.equal(initCalls[0].options.whenDraftExists, 'replace')
  assert.equal(draftCalls.length, 1)
  assert.equal(draftCalls[0].sessionId, 'session-1')
  assert.equal(draftCalls[0].files.length, 1)
  assert.equal(draftCalls[0].files[0].name, '一条便签.md')
  assert.equal(draftCalls[0].files[0].type, 'text/markdown')
  assert.equal(await draftCalls[0].files[0].text(), '---\r\ntitle: sample\r\n---\r\n# 第一行标题\r\n\r\n正文内容\r\n\r\n~~~md\r\n> [!warning] 代码示例\r\n~~~\r\n\r\n> 普通引用')
  assert.deepEqual(attachmentIds, ['draft-1'])
  assert.equal(render().some((node) => node.type === api.components.SendMenu), false)
})


test('stripCommentCallouts：首行标题 callout 保持原样，其后的评论 callout 被移除', (t) => {
  const strip = loadClient(t).mod.__test.stripCommentCallouts
  assert.equal(strip('> [!note] 标题\n\n正文\n\n> [!tip] 评论\n> 评论内容', 'firstLine'),
    '> [!note] 标题\n\n正文\n')
})

test('0.18.6 侧栏折叠：主面板上报 wide，展开时顶部留白缩短；拖拽栏为四格', () => {
  assert.match(CLIENT_SOURCE, /'data-sidebar-wide': sidebarWide === null/)
  assert.match(CLIENT_SOURCE, /\.SN_panel\[data-sidebar-wide='true'\] \.SN_head\{--sn-head-top-padding:/)
  assert.match(CLIENT_SOURCE, /sidebar\.footer\.action/)
  assert.match(CLIENT_SOURCE, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
  assert.match(CLIENT_SOURCE, /'data-action': kind/)
  assert.match(CLIENT_SOURCE, /onContextMenu: selection\.handlePanelContextMenu/)
  assert.doesNotMatch(CLIENT_SOURCE, /actions\.current\.onContextMenu/)
  assert.match(CLIENT_SOURCE, /data-drop='deepseek'\]\{--sn-drop-color:#5477bb\}/)
  assert.match(CLIENT_SOURCE, /data-drop='project'\]\{--sn-drop-color:#8B5CF6\}/)
})

test('浮层定位：菜单与右键菜单都夹在视口内，空间不足时翻到锚点上方', (t) => {
  const api = loadClient(t).mod.__test
  const below = api.sendMenuPosition({ left: 100, top: 100, right: 200, bottom: 140 }, { width: 280, height: 300 }, { width: 1024, height: 768 })
  assert.deepEqual(below, { left: 100, top: 146 })
  const flip = api.sendMenuPosition({ left: 900, top: 600, right: 980, bottom: 640 }, { width: 280, height: 300 }, { width: 1024, height: 768 })
  assert.equal(flip.left, 736)
  assert.equal(flip.top, 294)
  const edge = api.contextMenuPosition(1200, 900, { width: 200, height: 96 }, { width: 1024, height: 768 })
  assert.deepEqual(edge, { left: 816, top: 664 })
})

test('SidebarWideReporter：把宿主 wide 状态发布给主面板，并可清理', (t) => {
  const runner = hookRunner(t)
  const api = runner.api
  api.setSidebarWide(null)
  runner.render(api.components.SidebarWideReporter, { wide: true })
  assert.equal(api.getSidebarWide(), true)
  runner.render(api.components.SidebarWideReporter, { wide: false })
  assert.equal(api.getSidebarWide(), false)
  api.setSidebarWide(null)
  assert.equal(api.getSidebarWide(), null)
})

test('SendMenu：选中文字模式隐藏附件形式，只保留工作区选择', (t) => {
  const api = loadClient(t).mod.__test, calls = []
  const tree = api.components.SendMenu({
    t: (key) => key,
    menu: { kind: 'text', text: '选中的一段文字', format: 'text' },
    workspaces: { items: [DEFAULT_WORKSPACE, OTHER_WORKSPACE], defaultId: 'ws-default', primaryId: 'ws-default', phase: 'ready' },
    defaultId: 'ws-default',
    sending: false,
    onChoose: (workspace) => calls.push(['choose', workspace.workspaceId]),
    onFormat: () => calls.push(['format']),
    onClose: () => calls.push(['close']),
  })
  const nodes = captureNodes(tree)
  assert.equal(nodes.some((node) => node.props.className === 'SN_sendFormatBtn'), false)
  assert.ok(nodes.some((node) => node.props.className === 'SN_sendSelectionOnly'))
  assert.equal(nodes.find((node) => node.props.className === 'SN_sendMenu').props['aria-label'], 'send.titleText')
  assert.equal(nodes.filter((node) => node.props.className === 'SN_sendWorkspace').length, 2)
  nodes.find((node) => node.props.className === 'SN_sendWorkspace').props.onClick()
  assert.deepEqual(calls, [['choose', 'ws-default']])
})
