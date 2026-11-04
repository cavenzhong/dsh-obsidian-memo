/**
 * 0.13.8「在 Obsidian 打开」的纯函数 / 系统打开器单测。
 *
 * 这里只验证 URI 构造与 argv 调度；真正的系统调用在宿主测试里用
 * `setOpenExternalUrlForTests()` 覆盖，测试绝不会真的启动 Obsidian。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildObsidianUri } from '../lib/shared.js'
import {
  openExternalUrl,
  openNoteInObsidian,
  openUrlCommand,
  setOpenExternalUrlForTests,
  systemOpenExternalUrl,
} from '../lib/obsidian.js'

test('buildObsidianUri：用 path 参数 + 完整百分号编码；空路径返回空串', () => {
  assert.equal(buildObsidianUri(''), '')
  assert.equal(buildObsidianUri('   '), '')
  assert.equal(buildObsidianUri(null), '')
  assert.equal(buildObsidianUri(undefined), '')

  assert.equal(
    buildObsidianUri('/v/notes/a.md'),
    'obsidian://open?path=%2Fv%2Fnotes%2Fa.md',
  )

  const abs = '/Users/c/2024仓库/⛳️进行时&未整理/想法 1.md'
  const uri = buildObsidianUri(abs)
  assert.ok(uri.startsWith('obsidian://open?path='))
  assert.doesNotMatch(uri, / /, '空格必须被编码')
  assert.match(uri, /%26/, '& 必须被编码，避免被当成第二个 query 参数')
  assert.equal(
    decodeURIComponent(uri.slice('obsidian://open?path='.length)),
    abs,
    '解码后应还原成原绝对路径',
  )
})

test('openUrlCommand：macOS 用 open，Windows 用 cmd start，其他用 xdg-open', () => {
  const url = 'obsidian://open?path=%2Fa.md'
  assert.deepEqual(openUrlCommand(url, 'darwin'), { command: 'open', args: [url] })
  assert.deepEqual(openUrlCommand(url, 'win32'), { command: 'cmd', args: ['/c', 'start', '""', url] })
  assert.deepEqual(openUrlCommand(url, 'linux'), { command: 'xdg-open', args: [url] })
})

test('systemOpenExternalUrl：argv 调用系统命令，成功返回 { ok: true }', async () => {
  const calls = []
  const exec = (command, args, options, callback) => {
    calls.push({ command, args, options })
    callback(null)
  }
  const result = await systemOpenExternalUrl('obsidian://open?path=x', { exec, platform: 'darwin', timeoutMs: 1234 })
  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'open')
  assert.deepEqual(calls[0].args, ['obsidian://open?path=x'])
  assert.equal(calls[0].options.timeout, 1234)
})

test('systemOpenExternalUrl：命令失败（没装 Obsidian 等）返回 { ok: false, message }', async () => {
  const exec = (command, args, options, callback) => callback(new Error('Unable to find application'))
  const result = await systemOpenExternalUrl('obsidian://open?path=x', { exec, platform: 'darwin' })
  assert.equal(result.ok, false)
  assert.match(result.message, /Unable to find application/)
})

test('systemOpenExternalUrl：exec 同步抛错也不 reject', async () => {
  const exec = () => {
    throw new Error('boom')
  }
  const result = await systemOpenExternalUrl('obsidian://open?path=x', { exec, platform: 'linux' })
  assert.deepEqual(result, { ok: false, message: 'boom' })
})

test('openNoteInObsidian：测试覆盖点收到 obsidian:// URI；空路径/空链接不碰系统', async () => {
  const seen = []
  setOpenExternalUrlForTests(async (url) => {
    seen.push(url)
    return { ok: true }
  })
  try {
    const opened = await openNoteInObsidian('/v/notes/a.md')
    assert.equal(opened.ok, true)
    assert.equal(opened.url, 'obsidian://open?path=%2Fv%2Fnotes%2Fa.md')
    assert.deepEqual(seen, [opened.url])

    assert.equal((await openNoteInObsidian('')).ok, false)
    assert.equal(seen.length, 1, '空路径不应调用系统打开器')

    assert.equal((await openExternalUrl('   ')).ok, false)
    assert.equal(seen.length, 1, '空链接不应调用系统打开器')
  } finally {
    setOpenExternalUrlForTests(null)
  }
})
