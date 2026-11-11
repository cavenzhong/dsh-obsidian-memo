/** Client note-actions regression coverage. */
import test from 'node:test'
import { hookRunner, captureNodes, flush } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'

test('v0.16 右侧复制与删除复用卡片行为：复制完整正文，删除关闭面板且可撤回', async (t) => {
  const runner = hookRunner(t), requests = [], copied = []
  const previousDocument = globalThis.document, navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  globalThis.window.addEventListener = () => {}
  globalThis.window.removeEventListener = () => {}
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text) => copied.push(text) } } })
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator
  })
  const note = { path: '/full-note.md', name: '完整便签', title: '完整便签', excerpt: '截断摘要', comments: [], images: [], created: Date.now() }
  let notes = [note]
  const body = '# 完整标题\n\n第一段\n\n- [ ] 正文末尾也需要复制'
  runner.connect(async (channel, endpoint, payload) => {
    requests.push({ endpoint, payload })
    if (endpoint === 'state') return { ok: true, value: { configured: true, notes, revision: String(notes.length), jobs: [], settings: { emojis: [], archiveTargets: [] } } }
    if (endpoint === 'note') return { ok: true, value: { ...note, body, blocks: [{ kind: 'p', text: body }] } }
    if (endpoint === 'deleteNote') {
      notes = []
      return { ok: true, value: { undoToken: 'drawer-undo', expiresAt: Date.now() + 5000 } }
    }
    if (endpoint === 'undoDelete') { notes = [note]; return { ok: true, value: {} } }
    assert.fail('Unexpected endpoint ' + endpoint)
  })
  const render = () => captureNodes(runner.render(runner.api.components.StickyNotesPanel, { t: (key) => key }))
  render(); await flush()
  render().find((node) => node.type === runner.api.components.NoteCard).props.actions.current.onOpen(note)
  await flush()
  const drawer = render().find((node) => node.type === runner.api.components.NoteDrawer)
  assert.ok(drawer)
  await drawer.props.drawerActions.onCopy()
  assert.deepEqual(copied, [note.title + '\n' + body])
  await drawer.props.drawerActions.onDelete(); await flush()
  let nodes = render()
  assert.equal(nodes.some((node) => node.type === runner.api.components.NoteDrawer), false)
  assert.equal(nodes.some((node) => node.type === runner.api.components.NoteCard), false)
  assert.equal(requests.filter((request) => request.endpoint === 'deleteNote').length, 1)
  const toast = nodes.find((node) => node.type === runner.api.components.ToastStack).props.toasts.find((toast) => toast.action?.label === 'toast.deleteUndo')
  assert.ok(toast)
  await toast.action.run(); await flush(); nodes = render()
  assert.ok(requests.some((request) => request.endpoint === 'undoDelete' && request.payload.undoToken === 'drawer-undo'))
  assert.equal(nodes.filter((node) => node.type === runner.api.components.NoteCard).length, 1)
})
