/** Client registration regression coverage. */
import test from 'node:test'
import { loadClient, getTestApi, PACKAGE_JSON } from '../../test-support/client.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('client bundle：__ModuleLoader__ 注册 id / factory / inject / __test', (t) => {
  const { mod, registration } = loadClient(t)
  assert.equal(typeof registration.factory, 'function')
  assert.equal(typeof mod.apply, 'function')
  // 契约 §2 / §6.1：inject = ['slots', 'locale', 'connection']
  for (const service of ['slots', 'locale', 'connection']) {
    assert.ok(Array.isArray(mod.inject) && mod.inject.includes(service), `inject 缺少 ${service}`)
  }
  assert.notEqual(mod.__test, undefined)
  getTestApi(mod)
})

test('client __test：formatVersionLabel 取完整版本（含补丁号），缺失/非法不显示版本', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(typeof api.formatVersionLabel, 'function', '__test.formatVersionLabel 缺失（v0.13）')
  // 正常版本：保留完整 major.minor.patch，支持 v 前缀、预发布后缀、首尾空白
  assert.equal(api.formatVersionLabel('0.13.0'), '0.13.0')
  assert.equal(api.formatVersionLabel('v0.13.2'), '0.13.2')
  assert.equal(api.formatVersionLabel('0.13.4'), '0.13.4')
  assert.equal(api.formatVersionLabel('0.13.0-beta.1'), '0.13.0')
  assert.equal(api.formatVersionLabel('  0.13.4  '), '0.13.4')
  // 0.13.9.2 起支持四段发布号（package.json 版本即四段时也要完整显示）
  assert.equal(api.formatVersionLabel('0.13.9.2'), '0.13.9.2')
  assert.equal(api.formatVersionLabel('v0.13.9.2'), '0.13.9.2')
  assert.equal(api.formatVersionLabel('0.13.9.2-beta.1'), '0.13.9.2')
  assert.equal(api.formatVersionLabel('1.2.3'), '1.2.3')
  assert.equal(api.formatVersionLabel('1.2'), '1.2')
  // 缺失 / 空 / 非法 → 回退 APP_VERSION（旧 Host 没下发 version 的情况）
  for (const bad of [undefined, null, '', '   ', 'abc', 'v', 0, 123, true, {}, []]) {
    assert.equal(
      api.formatVersionLabel(bad),
      '',
      `formatVersionLabel(${JSON.stringify(bad)}) 应返回空串`,
    )
  }
})

test('版本仅从 Host 下发，locale 与浏览器代码无需手动同步版本', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.formatVersionLabel(PACKAGE_JSON.version), PACKAGE_JSON.version)
  for (const name of ['zh', 'en']) {
    const locale = JSON.parse(readFileSync(new URL('../../locale/' + name + '.json', import.meta.url), 'utf8'))
    assert.match(locale.meta.description, /Obsidian MEMO/)
    assert.doesNotMatch(locale.meta.description, /Obsidian MEMO \d/)
  }
})


test('客户端加载：宿主提供带 __esModule 标记的 React 命名导出时仍可注册', (t) => {
  const react = { __esModule: true, memo: (fn) => fn, createElement() {}, Fragment: Symbol() }
  const { mod } = loadClient(t, { react })
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.__test.components.NoteCard, 'function')
})
