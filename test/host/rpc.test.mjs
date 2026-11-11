/** host: rpc regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RPC_ID, envelopeBody, makeCase } from '../../test-support/host.mjs'

test('未知 endpoint 返回 bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const result = await c.call('no-such-endpoint', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
  assert.match(result.error.message, /未知 endpoint/)
})

test('RPC 路由：注册 prefix /sticky-notes，响应是 server-response 信封且 rpcId 回显', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n正文\n' } })
  assert.equal(c.route.kind, 'prefix')
  assert.equal(c.route.path, '/sticky-notes')
  assert.equal(typeof c.route.handler, 'function')

  const response = await c.request({ endpoint: 'state' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.envelope.type, 'server-response')
  assert.equal(response.envelope.rpcId, RPC_ID)
  assert.equal(response.envelope.result.ok, true)
  assert.equal(response.envelope.result.value.configured, true)

  // 自定义 rpcId 原样回显
  const custom = await c.request({ endpoint: 'state', rpcId: 'rpc-abc' })
  assert.equal(custom.envelope.rpcId, 'rpc-abc')
})

test('RPC 路由：非 POST（GET）返回 405，不返回信封', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const response = await c.request({ endpoint: 'state', method: 'GET' })
  assert.equal(response.statusCode, 405)
  assert.equal(response.body, 'method not allowed')
  assert.equal(response.envelope, null)
})

test('RPC 路由：body.method 与 URL 路径不匹配 → bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const mismatch = await c.request({
    endpoint: 'state',
    body: envelopeBody({ endpoint: 'saveNote', payload: {} }),
  })
  assert.equal(mismatch.statusCode, 200)
  assert.equal(mismatch.envelope.type, 'server-response')
  assert.equal(mismatch.envelope.rpcId, RPC_ID)
  assert.equal(mismatch.envelope.result.ok, false)
  assert.equal(mismatch.envelope.result.error.code, 'bad-request')
  assert.match(mismatch.envelope.result.error.message, /不匹配/)

  // body 里没有 method → endpoint 为空，同样拒绝
  const noMethod = await c.request({
    endpoint: 'state',
    body: JSON.stringify({ type: 'client-request', rpcId: RPC_ID, payload: {} }),
  })
  assert.equal(noMethod.envelope.result.ok, false)
  assert.equal(noMethod.envelope.result.error.code, 'bad-request')
})

test('RPC 路由：requestRejection 返回 403 / 401 时拒绝且不执行 dispatch', async () => {
  const forbidden = await makeCase({
    notes: { '甲.md': '# 甲\n\n原文\n' },
    ctx: { requestRejection: 403 },
  })
  const notePath = forbidden.seeded['甲.md']
  const before = await readFile(notePath, 'utf8')
  const denied = await forbidden.request({
    endpoint: 'saveNote',
    payload: { path: notePath, body: '不应写入' },
  })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.body, 'forbidden')
  assert.equal(denied.envelope, null)
  assert.equal(await readFile(notePath, 'utf8'), before)

  const unauthorized = await makeCase({
    notes: { '乙.md': '# 乙\n' },
    ctx: { requestRejection: 401 },
  })
  const unauthenticated = await unauthorized.request({ endpoint: 'state' })
  assert.equal(unauthenticated.statusCode, 401)
  assert.equal(unauthenticated.body, 'unauthorized')
  assert.equal(unauthenticated.envelope, null)
})

test('RPC 路由：requestRejection 收到请求 headers；通过时才继续 dispatch', async () => {
  let seen = null
  const c = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    ctx: {
      requestRejection: ({ headers }) => {
        seen = headers
        return undefined
      },
    },
  })
  const result = await c.call('state')
  assert.equal(result.ok, true)
  assert.equal(seen.cookie, 'sticky-test')
})

test('RPC 路由：非法 JSON / 读取 body 失败 / body 过大', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const invalidJson = await c.request({ endpoint: 'state', body: '这不是 JSON' })
  assert.equal(invalidJson.statusCode, 200)
  assert.equal(invalidJson.envelope.type, 'server-response')
  assert.equal(invalidJson.envelope.rpcId, 'invalid')
  assert.equal(invalidJson.envelope.result.ok, false)
  assert.equal(invalidJson.envelope.result.error.code, 'bad-request')
  assert.match(invalidJson.envelope.result.error.message, /JSON/)

  const unreadable = await c.request({ endpoint: 'state', throwOnRead: true })
  assert.equal(unreadable.statusCode, 400)
  assert.equal(unreadable.body, 'unreadable body')
  assert.equal(unreadable.envelope, null)

  const tooLarge = await c.request({ endpoint: 'state', body: 'x'.repeat(2 * 1024 * 1024 + 1) })
  assert.equal(tooLarge.statusCode, 400)
  assert.equal(tooLarge.body, 'unreadable body')
  assert.equal(tooLarge.envelope, null)
})

test('RPC 失败信封：业务错误都带 code/message/details，且不把原型链属性当 endpoint', async () => {
  const c = await makeCase({ notes: { '甲.md': '原文\n' } })
  const failures = [
    await c.call('saveNote', { path: c.seeded['甲.md'], body: '新正文', expectedRevision: 'stale' }),
    await c.call('note', { path: join(c.dir, 'outside.md') }),
    await c.call('no-such-endpoint', {}),
    await c.call('constructor', {}),
  ]
  assert.equal(failures[0].error.code, 'conflict')
  for (const result of failures) {
    assert.equal(result.ok, false)
    assert.equal(typeof result.error.code, 'string')
    assert.equal(typeof result.error.message, 'string')
    assert.deepEqual(result.error.details, {}, 'DSH client-connection 解析器要求失败信封带 details 对象')
  }
})
