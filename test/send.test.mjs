/** 0.18.6 发送到 DeepSeek 的共享纯规则。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SEND_SETTINGS, SEND_FORMATS, buildSendMessage, defaultWorkspaceIdOf,
  isDefaultWorkspace, normalizeSendSettings, resolveSendTarget, sortWorkspaces, workspaceDisplayName,
} from '../src/shared/send.js'

test('normalizeSendSettings：旧配置/非法值回退默认，只接受 white-list 形式', () => {
  assert.deepEqual(normalizeSendSettings(undefined), { ...DEFAULT_SEND_SETTINGS })
  assert.deepEqual(normalizeSendSettings(null), { ...DEFAULT_SEND_SETTINGS })
  assert.deepEqual(normalizeSendSettings('x'), { ...DEFAULT_SEND_SETTINGS })
  assert.deepEqual(normalizeSendSettings({ skipMenu: 'yes', workspaceId: ' w1 ', workspacePath: ' /p ', workspaceTitle: ' T ', format: 'bogus' }), {
    skipMenu: false,
    workspaceId: 'w1',
    workspacePath: '/p',
    workspaceTitle: 'T',
    format: 'text',
  })
  assert.equal(normalizeSendSettings({ skipMenu: true, format: 'document' }).skipMenu, true)
  assert.equal(normalizeSendSettings({ format: 'document' }).format, 'document')
  assert.deepEqual(SEND_FORMATS, ['text', 'document'])
})

test('buildSendMessage：原文模式标题作第一段，附件模式只把标题作为消息文字', () => {
  assert.equal(buildSendMessage({ format: 'text', title: '标题', body: '正文第一段' }), '标题\n\n正文第一段')
  assert.equal(buildSendMessage({ format: 'text', title: '标题', body: '' }), '标题')
  assert.equal(buildSendMessage({ format: 'text', title: '', body: '正文' }), '正文')
  assert.equal(buildSendMessage({ format: 'text', title: '', body: '' }), '')
  assert.equal(buildSendMessage({ format: 'document', title: '标题', body: '正文' }), '标题')
  assert.equal(buildSendMessage({ format: 'document', title: '', body: '正文' }), '')
})

test('工作区：默认工作区识别、排序、默认 id 与目标解析', () => {
  const items = [
    { workspaceId: 'other', title: '项目', path: '/work/project' },
    { workspaceId: 'default', title: 'default-workspace', path: '/work/default-workspace' },
    { workspaceId: 'another', title: '另一本', path: '/work/another' },
  ]
  assert.equal(isDefaultWorkspace(items[1]), true)
  assert.equal(isDefaultWorkspace({ title: '', path: '/x/default-workspace' }), true)
  assert.equal(isDefaultWorkspace(items[0]), false)
  assert.equal(workspaceDisplayName(items[1], '默认工作区'), '默认工作区')
  assert.equal(workspaceDisplayName(items[0], '默认工作区'), '项目')
  assert.equal(defaultWorkspaceIdOf(items), 'default')
  assert.deepEqual(sortWorkspaces(items).map((item) => item.workspaceId), ['default', 'another', 'other'])
  assert.equal(resolveSendTarget(items, 'default', { skipMenu: true, workspaceId: 'missing' }).workspaceId, 'default')
  assert.equal(resolveSendTarget(items, 'default', { workspaceId: '', workspacePath: '/work/another' }).workspaceId, 'another')
  assert.equal(resolveSendTarget(items, 'default', { workspaceId: 'other' }).workspaceId, 'other')
  assert.equal(resolveSendTarget([], 'default', {}), null)
})
