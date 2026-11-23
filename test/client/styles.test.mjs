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
  assert.match(css, /\.SN_taskCheck\{[^}]*margin-top:5px[^}]*border-radius:50%/)
  assert.match(css, /\.SN_taskCheck\[data-checked='true'\]\{background:var\(--sn-accent\);border-color:var\(--sn-accent\);color:#fff\}/)
  assert.match(css, /\.SN_blockLi:hover>\.SN_taskGrip,\.SN_taskGrip:focus-visible\{opacity:\.6\}/)
  assert.match(css, /\[data-list-dragging='true'\]\{[^}]*background-image:linear-gradient\(/)
  assert.match(css, /\.SN_blockLi\[data-list-drag-source='true'\]>\.SN_taskGrip\{opacity:1;cursor:grabbing\}/)
  assert.match(css, /\.SN_noteDrawerHeadActions\{[^}]*flex-direction:column/)
  assert.match(css, /\.SN_settingsTab\[data-tab='project'\]\{position:relative\}/)
  assert.match(css, /\.SN_settingsBeta\{position:absolute;inset-block-start:-5px;inset-inline-end:3px/)
  assert.doesNotMatch(css, /\.SN_settingsTab\[data-tab='project'\]\{[^}]*padding-top/)
  assert.match(css, /\.SN_panel\{--sn-serif:[^}]+--sn-sans:[^}]+display:flex;flex-direction:column;height:100%/)
  assert.match(css, /--sn-ink-title:#2b2620/)
  assert.match(css, /body\[data-ds-dark-theme\]/)
  assert.match(css, /body\[data-ds-dark-theme\] \.SN_drawerFoot \.SN_primaryBtn\{[^}]*background:var\(--sn-accent,#A78BFA\);color:#21182e\}/)
  assert.match(css, /body\[data-ds-dark-theme\] \.SN_drawerFoot \.SN_primaryBtn:disabled\{opacity:\.72\}/)
  assert.match(css, /\.SN_dateMenuBridge\{[^}]*top:100%[^}]*padding-top:6px/, '菜单外层接住日历下方空隙')
  assert.match(css, /\.SN_dateMenuBridge>\.SN_sortMenu\{[^}]*animation-name:SN_fadeIn/, '入场动画不移动菜单命中区')
  assert.match(css, /\.SN_cardActions::before\{[^}]*inset:-26px 0 0[^}]*pointer-events:none[^}]*var\(--sn-note-bg\) calc\(100% - 32px\)/, '浅深主题共用上延渐变，不截获鼠标')
  assert.ok(css.indexOf('.SN_captureDock{') < css.indexOf('.SN_noteDrawer{'))
  for (const cleanup of cleanups.splice(0)) cleanup()
  assert.equal(removed, 2)
  assert.equal(tags[0].parentNode, null)
})
