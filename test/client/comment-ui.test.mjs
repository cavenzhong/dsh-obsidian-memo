/** Client comment UI hooks: delete/undo flow and collapse persistence. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { flush, hookRunner } from '../../test-support/client.mjs'

test('v0.16.7 useCommentActions：删除带校验信息，成功后刷新并给 5 秒撤回', async (t) => {
  const runner = hookRunner(t)
  const api = runner.api
  const calls = []
  const note = { path: '/vault/a.md', full: { title: '便签', comments: [] } }
  const noteDrawerRef = { current: note }
  const request = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'deleteComment') {
      return { note: { path: note.path, commentGroups: [] }, undoToken: 'comment-undo', expiresAt: Date.now() + 5000 }
    }
    if (endpoint === 'undoDeleteComment') return { restoredTo: note.path }
    throw new Error('unexpected endpoint ' + endpoint)
  }
  const options = {
    aliveRef: { current: true },
    noteDrawerRef,
    request,
    loadNote: async (path) => calls.push({ loadNote: path }),
    refreshNow: async (force) => calls.push({ refresh: force }),
    replaceNote: (summary) => calls.push({ replace: summary }),
    pushToast: (toast) => calls.push({ toast }),
    pushErrorToast: (error) => calls.push({ error }),
    tRef: { current: (key) => key },
  }
  const render = () => runner.render((opts) => api.hooks.useCommentActions(opts), options)
  let hook = render()
  await hook.deleteComment(1, { title: '😈 毒舌 · 2026-11-13 10:00', time: '2026-11-13 10:00' })
  await flush()

  const deleteCall = calls.find((call) => call.endpoint === 'deleteComment')
  assert.deepEqual(deleteCall.payload, {
    path: note.path,
    index: 1,
    expectedTitle: '😈 毒舌 · 2026-11-13 10:00',
    expectedTime: '2026-11-13 10:00',
  })
  assert.equal(calls.some((call) => call.loadNote === note.path), true)
  assert.equal(calls.some((call) => call.replace && call.replace.path === note.path), true)
  assert.equal(calls.some((call) => call.refresh === false), true)
  const toast = calls.find((call) => call.toast).toast
  assert.equal(toast.text, 'toast.commentDeleted')
  assert.equal(toast.action.label, 'toast.undo')
  hook = render()
  assert.equal(hook.deletingIndex, null)

  await toast.action.run()
  await flush()
  const undoCall = calls.find((call) => call.endpoint === 'undoDeleteComment')
  assert.deepEqual(undoCall.payload, { undoToken: 'comment-undo' })
  assert.equal(calls.some((call) => call.toast && call.toast.text === 'toast.restored'), true)
})

test('v0.16.7 useCommentActions：失败时保留评论并报错刷新', async (t) => {
  const runner = hookRunner(t)
  const api = runner.api
  const calls = []
  const options = {
    aliveRef: { current: true },
    noteDrawerRef: { current: { path: '/vault/a.md', full: { title: '便签' } } },
    request: async () => { throw new Error('评论已变化') },
    loadNote: async (path) => calls.push({ loadNote: path }),
    refreshNow: async () => {},
    replaceNote: () => {},
    pushToast: () => {},
    pushErrorToast: (error) => calls.push({ error: error.message }),
    tRef: { current: (key) => key },
  }
  const hook = runner.render((opts) => api.hooks.useCommentActions(opts), options)
  await hook.deleteComment(0, { title: 'T', time: '' })
  await flush()
  assert.deepEqual(calls, [
    { error: '评论已变化' },
    { loadNote: '/vault/a.md' },
  ])
})

test('v0.16.7 useCommentsLayout：折叠状态写入 localStorage 并在重渲染后保持', (t) => {
  const runner = hookRunner(t)
  const api = runner.api
  const options = {}
  const render = () => runner.render(() => api.hooks.useCommentsLayout(), options)
  let hook = render()
  assert.equal(hook.commentsCollapsed, false)
  hook.toggleComments()
  assert.equal(api.readStoredCommentsCollapsed(), true)
  hook = render()
  assert.equal(hook.commentsCollapsed, true)
  hook.toggleComments()
  assert.equal(api.readStoredCommentsCollapsed(), false)
})

test('v0.16.7 useCommentsLayout：拖动顶边按实际头部/操作条收紧范围并持久化', (t) => {
  const runner = hookRunner(t)
  const api = runner.api
  const listeners = new Map()
  window.addEventListener = (name, fn) => listeners.set(name, fn)
  window.removeEventListener = (name) => listeners.delete(name)
  const section = { getBoundingClientRect: () => ({ height: 200, top: 400 }) }
  const drawer = {
    getBoundingClientRect: () => ({ height: 600, top: 0 }),
    querySelector(selector) {
      if (selector === '.SN_noteDrawerHead') return { getBoundingClientRect: () => ({ height: 90 }) }
      if (selector === '.SN_drawerActions') return { getBoundingClientRect: () => ({ height: 40 }) }
      return null
    },
  }
  const handle = {
    closest(selector) {
      if (selector === '.SN_noteDrawerComments') return section
      if (selector === '.SN_noteDrawer') return drawer
      return null
    },
    setPointerCapture() {},
  }
  const render = () => runner.render(() => api.hooks.useCommentsLayout(), {})
  let hook = render()
  hook.startCommentsResize({
    button: 0, pointerId: 1, clientY: 400, currentTarget: handle, stopPropagation() {},
  })
  assert.equal(listeners.has('pointermove'), true)
  // 600 - (90 + 40) - 140 = 330 是上限；200 + 100 = 300 在范围内。
  listeners.get('pointermove')({ clientY: 300 })
  hook = render()
  assert.equal(hook.commentsHeight, 300)
  // 继续往上拖会撞到 330 的上限。
  listeners.get('pointermove')({ clientY: 0 })
  hook = render()
  assert.equal(hook.commentsHeight, 330)
  listeners.get('pointerup')()
  assert.equal(listeners.has('pointermove'), false)
  assert.equal(api.readStoredCommentsHeight(), 330)
  hook = render()
  hook.resetCommentsHeight()
  hook = render()
  assert.equal(hook.commentsHeight, null)
  assert.equal(api.readStoredCommentsHeight(), null)
})
