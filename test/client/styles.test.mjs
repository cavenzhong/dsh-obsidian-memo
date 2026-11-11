import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from '../../test-support/client.mjs'

test('样式模块：基础布局和主题变量随组合样式注入，HMR 替换旧样式，卸载移除', (t) => {
  const { mod } = loadClient(t), cleanups = [], tags = []
  const previous = globalThis.document
  let removed = 0
  const head = {
    appendChild(tag) { tag.parentNode = head; tags.push(tag) },
    removeChild(tag) { tag.parentNode = null; removed++ },
  }
  const stale = { parentNode: head }
  globalThis.document = {
    head,
    querySelector: () => stale,
    createElement: () => ({ dataset: {} }),
  }
  t.after(() => {
    for (const cleanup of cleanups) cleanup()
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  })
  mod.apply({
    connection: {},
    locale: { register() {}, bind: () => (key) => key },
    slots: { inject() {} },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  })
  assert.equal(removed, 1)
  assert.equal(tags.length, 1)
  const css = tags[0].textContent
  assert.match(css, /\.SN_panel\{--sn-serif:[^}]+--sn-sans:[^}]+display:flex;flex-direction:column;height:100%/)
  assert.match(css, /--sn-ink-title:#2b2620/)
  assert.match(css, /body\[data-ds-dark-theme\]/)
  assert.ok(css.indexOf('.SN_captureDock{') < css.indexOf('.SN_noteDrawer{'))
  for (const cleanup of cleanups.splice(0)) cleanup()
  assert.equal(removed, 2)
  assert.equal(tags[0].parentNode, null)
})
